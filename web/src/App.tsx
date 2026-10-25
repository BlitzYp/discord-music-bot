import { useEffect, useState } from "react";
import { fetchGuilds } from "./api";
import { EffectPicker } from "./components/EffectPicker";
import { GuildPicker } from "./components/GuildPicker";
import { NowPlaying } from "./components/NowPlaying";
import { QueueList } from "./components/QueueList";
import type { GuildSummary } from "./shared";
import { useGuildState } from "./useGuildState";

/** The selected server lives in the URL (?guild=<id>), so a page reload or a shared link keeps it. */
function readGuildFromUrl(): string | null {
  return new URLSearchParams(location.search).get("guild");
}

function writeGuildToUrl(guildId: string | null): void {
  const url = new URL(location.href);
  if (guildId) url.searchParams.set("guild", guildId);
  else url.searchParams.delete("guild");
  history.replaceState(null, "", url);
}

export function App() {
  const [guilds, setGuilds] = useState<GuildSummary[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [guildId, setGuildId] = useState<string | null>(readGuildFromUrl);
  const { snapshot, receivedAt, error, connected } = useGuildState(guildId);

  useEffect(() => {
    fetchGuilds()
      .then((list) => {
        setGuilds(list);
        // With just one server there's nothing to choose.
        if (!readGuildFromUrl() && list.length === 1) selectGuild(list[0]!.id);
      })
      .catch((err: Error) => setLoadError(err.message));
  }, []);

  function selectGuild(id: string | null) {
    setGuildId(id);
    writeGuildToUrl(id);
  }

  const selectedGuild = guilds?.find((guild) => guild.id === guildId);

  return (
    <div className="page">
      <header>
        <h1>Music Bot</h1>
        {guilds && guilds.length > 1 && (
          <select value={guildId ?? ""} onChange={(event) => selectGuild(event.target.value || null)}>
            <option value="">Choose a server…</option>
            {guilds.map((guild) => (
              <option key={guild.id} value={guild.id}>
                {guild.name}
              </option>
            ))}
          </select>
        )}
        {guilds?.length === 1 && selectedGuild && <span className="muted">{selectedGuild.name}</span>}
      </header>

      {!connected && <p className="banner warning">Lost the connection to the bot. Reconnecting…</p>}
      {error && <p className="banner error">{error}</p>}
      {loadError && <p className="banner error">Couldn't load the server list: {loadError}</p>}

      {guilds && !guildId && <GuildPicker guilds={guilds} onPick={selectGuild} />}
      {guildId && !snapshot && connected && <p className="muted">Loading…</p>}
      {snapshot && guildId && (
        <main>
          <NowPlaying snapshot={snapshot} receivedAt={receivedAt} />
          <EffectPicker guildId={guildId} active={snapshot.filter} disabled={!snapshot.voiceChannelId} />
          <QueueList queue={snapshot.queue} />
        </main>
      )}

      <footer className="muted">Effects can be changed here. Everything else is controlled with slash commands in Discord for now.</footer>
    </div>
  );
}
