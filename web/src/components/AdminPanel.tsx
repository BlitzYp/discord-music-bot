import { type FormEvent, useEffect, useState } from "react";
import * as api from "../api";
import { type AdminStatus, formatDuration, type GlobalSettings, YOUTUBE_MODES, type YoutubeMode } from "../shared";
import { useAction } from "../useAction";
import { Field } from "./GuildSettingsForm";

const YOUTUBE_MODE_LABELS: Record<YoutubeMode, string> = {
  auto: "Automatic: Lavalink's YouTube plugin, yt-dlp if it fails (recommended)",
  lavalink: "Only Lavalink's YouTube plugin",
  ytdlp: "Only yt-dlp (every song takes ~10 seconds to start)",
};

/** How often the status refreshes while the page is open. */
const STATUS_REFRESH_MS = 10_000;

/** The bot owner's page: settings for the whole bot, and how its parts are doing. */
export function AdminPanel() {
  return (
    <main>
      <GlobalSettingsForm />
      <StatusCard />
    </main>
  );
}

function GlobalSettingsForm() {
  const [saved, setSaved] = useState<GlobalSettings | null>(null);
  const [draft, setDraft] = useState<GlobalSettings | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const { run, pending, error } = useAction();

  useEffect(() => {
    api
      .fetchGlobalSettings()
      .then((settings) => {
        setSaved(settings);
        setDraft(settings);
      })
      .catch((err: Error) => setLoadError(err.message));
  }, []);

  if (loadError) return <p className="banner error">Couldn't load the settings: {loadError}</p>;
  if (!saved || !draft) return <p className="muted">Loading…</p>;

  async function save(event: FormEvent) {
    event.preventDefault();
    await run(async () => {
      const settings = await api.updateGlobalSettings(draft!);
      setSaved(settings);
      setDraft(settings);
    });
  }

  const hasChanges = JSON.stringify(draft) !== JSON.stringify(saved);

  return (
    <form className="card settings" onSubmit={save}>
      <h3>Bot settings</h3>
      <p className="muted hint top-hint">These apply to every server. Only you (OWNER_ID) can see this page.</p>

      <Field label="YouTube links" hint="How YouTube songs are loaded. Applies from the next song. Other sites always try Lavalink first, then yt-dlp.">
        <select value={draft.youtubeMode} onChange={(event) => setDraft({ ...draft, youtubeMode: event.target.value as YoutubeMode })}>
          {YOUTUBE_MODES.map((mode) => (
            <option key={mode} value={mode}>
              {YOUTUBE_MODE_LABELS[mode]}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Update yt-dlp on start" hint="YouTube changes often break old yt-dlp versions, so the bot updates it every time it starts.">
        <label className="checkbox">
          <input
            type="checkbox"
            checked={draft.ytdlpAutoUpdate}
            onChange={(event) => setDraft({ ...draft, ytdlpAutoUpdate: event.target.checked })}
          />
          On
        </label>
      </Field>

      <div className="save-row">
        <button type="submit" className="primary" disabled={pending || !hasChanges}>
          {pending ? "Saving…" : "Save"}
        </button>
        {error && <span className="error-text">{error}</span>}
      </div>
    </form>
  );
}

function StatusCard() {
  const [status, setStatus] = useState<AdminStatus | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [updateMessage, setUpdateMessage] = useState<string | null>(null);
  const update = useAction();

  useEffect(() => {
    const load = () =>
      api
        .fetchAdminStatus()
        .then((next) => {
          setStatus(next);
          setLoadError(null);
        })
        .catch((err: Error) => setLoadError(err.message));
    void load();
    const timer = setInterval(load, STATUS_REFRESH_MS);
    return () => clearInterval(timer);
  }, []);

  async function updateYtDlp() {
    setUpdateMessage(null);
    await update.run(async () => {
      const { message } = await api.updateYtDlpNow();
      setUpdateMessage(message);
    });
  }

  return (
    <section className="card">
      <h3>Status</h3>
      {loadError && <p className="error-text">Couldn't load the status: {loadError}</p>}
      {!status && !loadError && <p className="muted">Loading…</p>}
      {status && (
        <dl className="status">
          <dt>Bot</dt>
          <dd>
            Running for {formatUptime(status.bot.uptimeMs)} · in {status.bot.servers} servers · in voice in {status.bot.activePlayers}
          </dd>

          <dt>Lavalink</dt>
          <dd>
            {status.lavalink.connected ? (
              <>
                <span className="ok">Connected</span> · version {status.lavalink.version ?? "?"} · YouTube plugin{" "}
                {status.lavalink.youtubePluginVersion ?? "not loaded"} · playing in {status.lavalink.playingPlayers} of{" "}
                {status.lavalink.players} players · {status.lavalink.memoryUsedMb} MB memory · up{" "}
                {formatUptime(status.lavalink.uptimeMs ?? 0)}
              </>
            ) : (
              <span className="error-text">Not connected. Is <code>npm run lavalink</code> running?</span>
            )}
          </dd>

          <dt>yt-dlp</dt>
          <dd>
            {status.ytdlp.version ?? <span className="error-text">not found (run <code>npm run setup:ytdlp</code>)</span>}{" "}
            <button type="button" className="small" disabled={update.pending} onClick={updateYtDlp}>
              {update.pending ? "Updating…" : "Update now"}
            </button>
            {updateMessage && <span className="muted"> {updateMessage}</span>}
            {update.error && <span className="error-text"> {update.error}</span>}
          </dd>
        </dl>
      )}
    </section>
  );
}

/** "3:12:05" for hours, "2 days 4:10:00" for longer. */
function formatUptime(ms: number): string {
  const days = Math.floor(ms / 86_400_000);
  const rest = formatDuration(ms % 86_400_000);
  return days > 0 ? `${days} day${days === 1 ? "" : "s"} ${rest}` : rest;
}
