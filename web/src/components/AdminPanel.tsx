import { type FormEvent, useEffect, useState } from "react";
import * as api from "../api";
import {
  type AdminStatus,
  BOT_STATUS_DOTS,
  BOT_STATUS_TYPES,
  type BotStatus,
  type BotStatusDot,
  type BotStatusType,
  formatDuration,
  GLOBAL_SETTING_LIMITS,
  type GlobalSettings,
  MAX_BOT_STATUS_LENGTH,
  YOUTUBE_MODES,
  type YoutubeMode,
} from "../shared";
import { useAction } from "../useAction";
import { Field, NumberInput } from "./GuildSettingsForm";
import { VoicesCard } from "./VoicesCard";

const YOUTUBE_MODE_LABELS: Record<YoutubeMode, string> = {
  auto: "Automatic: Lavalink's YouTube plugin, yt-dlp if it fails (recommended)",
  lavalink: "Only Lavalink's YouTube plugin",
  ytdlp: "Only yt-dlp (every song takes ~10 seconds to start)",
};

/** How Discord writes each kind of status, "{text}" standing for the status text. */
const STATUS_TYPE_LABELS: Record<BotStatusType, string> = {
  custom: "{text}",
  listening: "Listening to {text}",
  playing: "Playing {text}",
  watching: "Watching {text}",
  competing: "Competing in {text}",
};

const STATUS_DOT_LABELS: Record<BotStatusDot, string> = {
  online: "Online (green)",
  idle: "Idle (moon)",
  dnd: "Do not disturb (red)",
};

/** A fixed status as Discord shows it, e.g. "Listening to the radio". */
function describeStatus({ type, text }: Pick<BotStatus, "type" | "text">): string {
  return STATUS_TYPE_LABELS[type].replace("{text}", text);
}

/** How often the status refreshes while the page is open. */
const STATUS_REFRESH_MS = 10_000;

/** The bot owner's page: settings for the whole bot, and how its parts are doing. */
export function AdminPanel() {
  return (
    <main>
      <GlobalSettingsForm />
      <VoicesCard />
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

      <Field label="Largest upload" hint="The biggest audio file one library upload may be.">
        <NumberInput
          value={draft.maxUploadMb}
          limits={GLOBAL_SETTING_LIMITS.maxUploadMb}
          unit="MB"
          onChange={(value) => setDraft({ ...draft, maxUploadMb: value ?? draft.maxUploadMb })}
        />
      </Field>

      <Field label="Library space per server" hint="How much disk space each server's library may use. Files already uploaded stay when you lower it.">
        <NumberInput
          value={draft.guildQuotaMb}
          limits={GLOBAL_SETTING_LIMITS.guildQuotaMb}
          unit="MB"
          onChange={(value) => setDraft({ ...draft, guildQuotaMb: value ?? draft.guildQuotaMb })}
        />
      </Field>

      <StatusOverrideField value={draft.statusOverride} onChange={(statusOverride) => setDraft({ ...draft, statusOverride })} />

      <div className="save-row">
        <button type="submit" className="primary" disabled={pending || !hasChanges}>
          {pending ? "Saving…" : "Save"}
        </button>
        {error && <span className="error-text">{error}</span>}
      </div>
    </form>
  );
}

interface StatusOverrideFieldProps {
  /** null = automatic. */
  value: BotStatus | null;
  onChange: (value: BotStatus | null) => void;
}

/** The bot's Discord status: automatic (what it's playing), or a fixed one the owner types. */
function StatusOverrideField({ value, onChange }: StatusOverrideFieldProps) {
  return (
    <Field
      label="Discord status"
      hint="Automatic shows what the bot is doing: “Listening to <song>”, “⏸ Paused”, “Idle · /play to start”. A custom status stays until you switch back to automatic."
    >
      <div className="status-override">
        <select
          aria-label="Status mode"
          value={value ? "custom" : "automatic"}
          onChange={(event) => onChange(event.target.value === "custom" ? { type: "custom", text: "", dot: "online" } : null)}
        >
          <option value="automatic">Automatic: what the bot is doing</option>
          <option value="custom">Custom</option>
        </select>

        {value && (
          <>
            <select
              aria-label="Kind of status"
              value={value.type}
              onChange={(event) => onChange({ ...value, type: event.target.value as BotStatusType })}
            >
              {BOT_STATUS_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type === "custom" ? "Just the text" : describeStatus({ type, text: "…" })}
                </option>
              ))}
            </select>
            <input
              type="text"
              aria-label="Status text"
              placeholder="Status text"
              maxLength={MAX_BOT_STATUS_LENGTH}
              value={value.text}
              onChange={(event) => onChange({ ...value, text: event.target.value })}
            />
            <select aria-label="Dot" value={value.dot} onChange={(event) => onChange({ ...value, dot: event.target.value as BotStatusDot })}>
              {BOT_STATUS_DOTS.map((dot) => (
                <option key={dot} value={dot}>
                  {STATUS_DOT_LABELS[dot]}
                </option>
              ))}
            </select>
            {value.text.trim() && <p className="muted hint">Shows as: {describeStatus(value)}</p>}
          </>
        )}
      </div>
    </Field>
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

          <dt>Discord status</dt>
          <dd>
            {describeStatus(status.discordStatus)} · {STATUS_DOT_LABELS[status.discordStatus.dot].toLowerCase()} ·{" "}
            <span className="muted">{status.discordStatus.overridden ? "custom (set above)" : "automatic"}</span>
          </dd>

          <dt>ffmpeg</dt>
          <dd>
            {status.ffmpeg.version ?? (
              <span className="error-text">
                not found: library uploads won't work (install it with <code>winget install Gyan.FFmpeg</code>, then restart the bot)
              </span>
            )}
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
