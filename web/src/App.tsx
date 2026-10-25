import { useEffect, useState } from "react";
import * as api from "./api";
import { AddSong } from "./components/AddSong";
import { EffectPicker } from "./components/EffectPicker";
import { GuildPicker } from "./components/GuildPicker";
import { HistoryList } from "./components/HistoryList";
import { NowPlaying } from "./components/NowPlaying";
import { QueueList } from "./components/QueueList";
import { type GuildSummary, hasLevel, type SessionUser } from "./shared";
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

/** Who is logged in: `undefined` while checking, `null` if nobody. */
type LoginState = SessionUser | null | undefined;

export function App() {
  const [user, setUser] = useState<LoginState>(undefined);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    api
      .fetchMe()
      .then(setUser)
      .catch((err: Error) => setLoadError(err.message));
  }, []);

  async function logout() {
    await api.logout();
    location.reload(); // also reconnects the live connection without the old login
  }

  return (
    <div className="page">
      <header>
        <h1>Music Bot</h1>
        {user && (
          <span className="account">
            <img src={user.avatarUrl} alt="" />
            {user.name}
            <button type="button" className="small" onClick={logout}>
              Log out
            </button>
          </span>
        )}
      </header>

      {loadError && <p className="banner error">Couldn't reach the bot: {loadError}</p>}
      {user === null && <LoginScreen />}
      {user && <Dashboard />}
    </div>
  );
}

function LoginScreen() {
  return (
    <section className="card empty">
      <p>Log in with your Discord account to see your servers.</p>
      <a className="button" href={api.LOGIN_URL}>
        Log in with Discord
      </a>
      <p className="muted hint">The website only learns your Discord name and avatar.</p>
    </section>
  );
}

/** The logged-in view: pick a server, then see (and, as a DJ, control) what's playing there. */
function Dashboard() {
  const [guilds, setGuilds] = useState<GuildSummary[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [guildId, setGuildId] = useState<string | null>(readGuildFromUrl);
  const { snapshot, receivedAt, error, connected } = useGuildState(guildId);

  useEffect(() => {
    api
      .fetchGuilds()
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

  const guild = guilds?.find((g) => g.id === guildId);
  // Hiding controls is only for convenience: the bot checks the permission again for every change.
  const canControl = guild ? hasLevel(guild.level, "dj") : false;

  return (
    <>
      {guilds && guilds.length > 1 && (
        <select className="server-select" value={guildId ?? ""} onChange={(event) => selectGuild(event.target.value || null)}>
          <option value="">Choose a server…</option>
          {guilds.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
      )}
      {guilds?.length === 1 && guild && <p className="muted server-name">{guild.name}</p>}

      {!connected && <p className="banner warning">Lost the connection to the bot. Reconnecting…</p>}
      {error && <p className="banner error">{error}</p>}
      {loadError && <p className="banner error">Couldn't load your servers: {loadError}</p>}

      {guilds && !guildId && <GuildPicker guilds={guilds} onPick={selectGuild} />}
      {guildId && !snapshot && connected && <p className="muted">Loading…</p>}
      {snapshot && guildId && (
        <main>
          {canControl && <AddSong guildId={guildId} />}
          <NowPlaying guildId={guildId} snapshot={snapshot} receivedAt={receivedAt} canControl={canControl} />
          <EffectPicker
            guildId={guildId}
            active={snapshot.filter}
            canControl={canControl}
            inVoice={snapshot.voiceChannelId !== null}
          />
          <QueueList guildId={guildId} queue={snapshot.queue} canControl={canControl} />
          <HistoryList guildId={guildId} history={snapshot.history} canControl={canControl} />
        </main>
      )}
    </>
  );
}
