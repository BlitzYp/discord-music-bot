import { useEffect, useState } from "react";
import * as api from "./api";
import { AddSong } from "./components/AddSong";
import { AdminPanel } from "./components/AdminPanel";
import { EffectPicker } from "./components/EffectPicker";
import { GuildPicker } from "./components/GuildPicker";
import { GuildSettingsForm } from "./components/GuildSettingsForm";
import { HistoryList } from "./components/HistoryList";
import { NowPlaying } from "./components/NowPlaying";
import { QueueList } from "./components/QueueList";
import { type CurrentUser, type GuildSummary, hasLevel } from "./shared";
import { useGuildState } from "./useGuildState";

/**
 * Which page is showing:
 * - "player": a server's current song, queue and controls;
 * - "settings": a server's settings (server admins);
 * - "admin": the bot owner's settings and status.
 */
type View = "player" | "settings" | "admin";

/**
 * The selected server and page live in the URL (?guild=<id>&view=settings), so a page reload or a shared link
 * keeps them.
 */
function readUrl(): { guildId: string | null; view: View } {
  const params = new URLSearchParams(location.search);
  const view = params.get("view");
  return {
    guildId: params.get("guild"),
    view: view === "settings" || view === "admin" ? view : "player",
  };
}

function writeUrl(guildId: string | null, view: View): void {
  const url = new URL(location.href);
  if (guildId) url.searchParams.set("guild", guildId);
  else url.searchParams.delete("guild");
  if (view !== "player") url.searchParams.set("view", view);
  else url.searchParams.delete("view");
  history.replaceState(null, "", url);
}

/** Who is logged in: `undefined` while checking, `null` if nobody. */
type LoginState = CurrentUser | null | undefined;

export function App() {
  const [user, setUser] = useState<LoginState>(undefined);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [guildId, setGuildId] = useState<string | null>(() => readUrl().guildId);
  const [view, setView] = useState<View>(() => readUrl().view);

  useEffect(() => {
    api
      .fetchMe()
      .then(setUser)
      .catch((err: Error) => setLoadError(err.message));
  }, []);

  function navigate(nextGuildId: string | null, nextView: View) {
    setGuildId(nextGuildId);
    setView(nextView);
    writeUrl(nextGuildId, nextView);
  }

  async function logout() {
    await api.logout();
    location.reload(); // also reconnects the live connection without the old login
  }

  const showAdmin = view === "admin" && user?.isOwner;

  return (
    <div className="page">
      <header>
        <h1>
          <button type="button" className="link" onClick={() => navigate(guildId, "player")}>
            Music Bot
          </button>
        </h1>
        {user && (
          <span className="account">
            {user.isOwner && (
              <button
                type="button"
                className={`small ${showAdmin ? "active" : ""}`}
                onClick={() => navigate(guildId, showAdmin ? "player" : "admin")}
              >
                Admin
              </button>
            )}
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
      {user && showAdmin && <AdminPanel />}
      {user && !showAdmin && (
        <Dashboard guildId={guildId} view={view === "settings" ? "settings" : "player"} onNavigate={navigate} />
      )}
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

interface DashboardProps {
  guildId: string | null;
  view: "player" | "settings";
  onNavigate: (guildId: string | null, view: View) => void;
}

/** The logged-in view: pick a server, then see (and, as a DJ, control) what's playing there, or its settings. */
function Dashboard({ guildId, view, onNavigate }: DashboardProps) {
  const [guilds, setGuilds] = useState<GuildSummary[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const { snapshot, receivedAt, error, connected } = useGuildState(guildId);

  useEffect(() => {
    api
      .fetchGuilds()
      .then((list) => {
        setGuilds(list);
        // With just one server there's nothing to choose.
        if (!readUrl().guildId && list.length === 1) onNavigate(list[0]!.id, "player");
      })
      .catch((err: Error) => setLoadError(err.message));
  }, []);

  const guild = guilds?.find((g) => g.id === guildId);
  // Hiding controls is only for convenience: the bot checks the permission again for every change.
  const canControl = guild ? hasLevel(guild.level, "dj") : false;
  const isAdmin = guild ? hasLevel(guild.level, "admin") : false;
  const showSettings = view === "settings" && isAdmin;

  return (
    <>
      {guilds && guilds.length > 1 && (
        <select className="server-select" value={guildId ?? ""} onChange={(event) => onNavigate(event.target.value || null, view)}>
          <option value="">Choose a server…</option>
          {guilds.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
      )}
      {guilds?.length === 1 && guild && <p className="muted server-name">{guild.name}</p>}

      {guild && isAdmin && (
        <nav className="tabs">
          <button type="button" className={showSettings ? "" : "active"} onClick={() => onNavigate(guild.id, "player")}>
            Player
          </button>
          <button type="button" className={showSettings ? "active" : ""} onClick={() => onNavigate(guild.id, "settings")}>
            Settings
          </button>
        </nav>
      )}

      {!connected && <p className="banner warning">Lost the connection to the bot. Reconnecting…</p>}
      {error && <p className="banner error">{error}</p>}
      {loadError && <p className="banner error">Couldn't load your servers: {loadError}</p>}

      {guilds && !guildId && <GuildPicker guilds={guilds} onPick={(id) => onNavigate(id, "player")} />}
      {showSettings && guildId && <GuildSettingsForm guildId={guildId} />}
      {!showSettings && guildId && !snapshot && connected && <p className="muted">Loading…</p>}
      {!showSettings && snapshot && guildId && (
        <main>
          {guild && !canControl && (
            <p className="muted hint member-hint">You can watch, but only DJs can control playback. A server admin picks the DJ role.</p>
          )}
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
