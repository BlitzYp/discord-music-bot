import { type FormEvent, type ReactNode, useEffect, useState } from "react";
import * as api from "../api";
import { type GuildSettings, type GuildSettingsResponse, SETTING_LIMITS, UPLOAD_PERMISSIONS, type UploadPermission } from "../shared";
import { useAction } from "../useAction";
import { AutoAnnouncementFields } from "./AutoAnnouncementFields";
import { VoiceFields } from "./VoiceFields";

const UPLOAD_PERMISSION_LABELS: Record<UploadPermission, string> = {
  dj: "DJs (and admins)",
  admin: "Only server admins",
  off: "Nobody: uploads are off",
};

/** A server's settings page (DJ role, volume, limits...). Only shown to server admins; the bot checks again. */
export function GuildSettingsForm({ guildId }: { guildId: string }) {
  const [loaded, setLoaded] = useState<GuildSettingsResponse | null>(null);
  /** The settings as edited on the page, saved with the Save button. */
  const [draft, setDraft] = useState<GuildSettings | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);
  const { run, pending, error, clearError } = useAction();

  useEffect(() => {
    setLoaded(null);
    setLoadError(null);
    api
      .fetchGuildSettings(guildId)
      .then((response) => {
        setLoaded(response);
        setDraft(response.settings);
      })
      .catch((err: Error) => setLoadError(err.message));
  }, [guildId]);

  if (loadError) return <p className="banner error">Couldn't load the settings: {loadError}</p>;
  if (!loaded || !draft) return <p className="muted">Loading…</p>;

  function change<K extends keyof GuildSettings>(key: K, value: GuildSettings[K]) {
    setDraft((previous) => previous && { ...previous, [key]: value });
    setJustSaved(false);
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    await run(async () => {
      // Volume normalization is switched on the player (DJs), not here; the bot refuses it on this page.
      const { normalizeVolume: _notOnThisPage, ...changes } = draft!;
      const response = await api.updateGuildSettings(guildId, changes);
      setLoaded(response);
      setDraft(response.settings);
      setJustSaved(true);
    });
  }

  const hasChanges = JSON.stringify(draft) !== JSON.stringify(loaded.settings);
  const everyoneRoleId = guildId; // Discord gives the @everyone role the server's id
  const namedRoles = loaded.roles.filter((role) => role.id !== everyoneRoleId);
  const djRoleName = draft.djRoleId === everyoneRoleId
    ? "Everyone is a DJ"
    : loaded.roles.find((role) => role.id === draft.djRoleId)?.name ?? "Admins only";
  const enabledAnnouncements = Object.values(draft.autoAnnouncements).filter((announcement) => announcement.enabled).length;

  return (
    <form
      className="card settings guild-settings"
      onSubmit={save}
      onInvalidCapture={(event) => {
        // Reveal an invalid input before the browser tries to focus it, even if its section was closed.
        if (event.target instanceof HTMLElement) {
          const section = event.target.closest("details");
          if (section) section.open = true;
        }
      }}
    >
      <div>
        <h3>Server settings</h3>
        <p className="muted hint">Choose a section to edit. Save when you're ready.</p>
      </div>

      <fieldset className="settings-groups" disabled={pending}>
        <SettingsSection title="Permissions" summary={`DJ role: ${djRoleName}`} initiallyOpen>
          <Field
            inputId="dj-role"
            label="DJ role"
            hint="DJs control playback. Server admins always have access."
          >
            <select id="dj-role" value={draft.djRoleId ?? ""} onChange={(event) => change("djRoleId", event.target.value || null)}>
              <option value="">No DJ role: only admins control playback</option>
              <option value={everyoneRoleId}>@everyone: every member is a DJ</option>
              {namedRoles.map((role) => (
                <option key={role.id} value={role.id}>
                  {role.name}
                </option>
              ))}
            </select>
          </Field>

          <Field inputId="same-voice-channel" label="Same voice channel" hint="DJs must join the bot's channel to control playback. Admins are exempt.">
            <label className="switch">
              <input
                id="same-voice-channel"
                type="checkbox"
                aria-label="Require the same voice channel"
                checked={draft.requireSameVoiceChannel}
                onChange={(event) => change("requireSameVoiceChannel", event.target.checked)}
              />
              {draft.requireSameVoiceChannel ? "Required" : "Not required"}
            </label>
          </Field>

          <Field inputId="upload-permission" label="Library uploads" hint="Who can add audio files for everyone in this server to play.">
            <select id="upload-permission" value={draft.uploadPermission} onChange={(event) => change("uploadPermission", event.target.value as UploadPermission)}>
              {UPLOAD_PERMISSIONS.map((permission) => (
                <option key={permission} value={permission}>
                  {UPLOAD_PERMISSION_LABELS[permission]}
                </option>
              ))}
            </select>
          </Field>
        </SettingsSection>

        <SettingsSection title="Playback" summary={`${draft.defaultVolume}% starting volume · ${draft.maxQueueLength === null ? "No queue limit" : `${draft.maxQueueLength} songs max`}`}>
          <Field inputId="starting-volume" label="Starting volume" hint="Used when joining a voice channel. 100% is normal.">
            <NumberInput
              id="starting-volume"
              value={draft.defaultVolume}
              limits={SETTING_LIMITS.defaultVolume}
              unit="%"
              onChange={(value) => change("defaultVolume", value ?? draft.defaultVolume)}
            />
          </Field>

          <Field inputId="queue-limit" label="Queue limit" hint="Maximum waiting songs. Leave empty for no limit.">
            <NumberInput
              id="queue-limit"
              value={draft.maxQueueLength}
              limits={SETTING_LIMITS.maxQueueLength}
              unit="songs"
              placeholder="no limit"
              onChange={(value) => change("maxQueueLength", value)}
            />
          </Field>

          <Field inputId="longest-song" label="Longest song" hint="Leave empty for no limit. Livestreams are always allowed.">
            <NumberInput
              id="longest-song"
              // Shown in minutes, stored in seconds.
              value={draft.maxTrackDurationSec === null ? null : Math.round(draft.maxTrackDurationSec / 60)}
              limits={{ min: 1, max: SETTING_LIMITS.maxTrackDurationSec.max / 60 }}
              unit="minutes"
              placeholder="no limit"
              onChange={(minutes) => change("maxTrackDurationSec", minutes === null ? null : minutes * 60)}
            />
          </Field>

          <Field inputId="leave-after" label="Leave an empty channel after" hint="Stops and disconnects when nobody is listening. 0 = stay connected.">
            <NumberInput
              id="leave-after"
              value={draft.leaveWhenEmptyAfterSec}
              limits={SETTING_LIMITS.leaveWhenEmptyAfterSec}
              unit="seconds"
              onChange={(value) => change("leaveWhenEmptyAfterSec", value ?? draft.leaveWhenEmptyAfterSec)}
            />
          </Field>
        </SettingsSection>

        <SettingsSection title="Announcements" summary={`${draft.announceChannelId ? "Text posts on" : "Text posts off"} · ${enabledAnnouncements} automatic voice ${enabledAnnouncements === 1 ? "message" : "messages"} on`}>
          <Field inputId="announce-channel" label="Now playing channel" hint="Post the current song in a text channel.">
            <select id="announce-channel" value={draft.announceChannelId ?? ""} onChange={(event) => change("announceChannelId", event.target.value || null)}>
              <option value="">Don't announce</option>
              {loaded.textChannels.map((channel) => (
                <option key={channel.id} value={channel.id}>
                  #{channel.name}
                </option>
              ))}
            </select>
          </Field>

          <div className="settings-section-heading">
            <h4>Spoken announcements</h4>
            <p className="muted hint">
              Used for /announce and the automatic messages below. Music pauses while the bot speaks.
            </p>
          </div>
          <VoiceFields
            guildId={guildId}
            voices={loaded.voices}
            voiceId={draft.voiceId}
            speed={draft.speechSpeed}
            onVoiceChange={(id) => change("voiceId", id)}
            onSpeedChange={(value) => change("speechSpeed", value)}
          />
          <AutoAnnouncementFields value={draft.autoAnnouncements} onChange={(value) => change("autoAnnouncements", value)} />
        </SettingsSection>
      </fieldset>

      <div className="save-row settings-save-row">
        <span className="muted settings-save-status" role="status">
          {hasChanges ? "Unsaved changes" : justSaved ? "Saved. Changes apply right away." : "All changes saved"}
        </span>
        {hasChanges && (
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              setDraft(loaded.settings);
              setJustSaved(false);
              clearError();
            }}
          >
            Discard
          </button>
        )}
        <button type="submit" className="primary" disabled={pending || !hasChanges}>
          {pending ? "Saving…" : "Save changes"}
        </button>
        {error && <span className="error-text" role="alert">{error}</span>}
      </div>
    </form>
  );
}

/** Native disclosures stay keyboard-accessible and keep draft values when a section is closed. */
function SettingsSection({ title, summary, initiallyOpen = false, children }: {
  title: string;
  summary: string;
  initiallyOpen?: boolean;
  children: ReactNode;
}) {
  return (
    <details className="settings-section" open={initiallyOpen}>
      <summary>
        <span className="settings-section-title">{title}</span>
        <span className="muted settings-section-summary">{summary}</span>
      </summary>
      <div className="settings-section-content">{children}</div>
    </details>
  );
}

/** One setting: a label, the input, and a line explaining it. */
export function Field({ label, hint, inputId, children }: { label: string; hint: string; inputId?: string; children: ReactNode }) {
  return (
    <div className="field">
      {inputId ? <label className="field-label" htmlFor={inputId}>{label}</label> : <span className="field-label">{label}</span>}
      <div className="field-input">{children}</div>
      <p className="muted field-hint">{hint}</p>
    </div>
  );
}

interface NumberInputProps {
  id?: string;
  value: number | null;
  limits: { min: number; max: number };
  unit: string;
  /** Shown when empty. Only settings that may be empty ("no limit") have one; for them, emptying the box sends null. */
  placeholder?: string;
  onChange: (value: number | null) => void;
}

/** A whole-number input. The browser stops numbers outside `limits`; the bot checks them again when saving. */
export function NumberInput({ id, value, limits, unit, placeholder, onChange }: NumberInputProps) {
  // The box keeps its own text, so it can be emptied while typing a new number without snapping back.
  const [text, setText] = useState(value === null ? "" : String(value));
  // Follow the value when it changes from outside, e.g. after saving.
  useEffect(() => setText(value === null ? "" : String(value)), [value]);

  function edit(newText: string) {
    setText(newText);
    if (newText !== "") onChange(Math.round(Number(newText)));
    else if (placeholder) onChange(null);
  }

  return (
    <label className="number-input">
      <input
        id={id}
        type="number"
        min={limits.min}
        max={limits.max}
        step={1}
        value={text}
        placeholder={placeholder}
        onChange={(event) => edit(event.target.value)}
        onBlur={() => {
          // Required numbers may be blank while typing, but clearing them does not change their saved value.
          if (text === "" && value !== null) setText(String(value));
        }}
      />
      <span className="muted">{unit}</span>
    </label>
  );
}
