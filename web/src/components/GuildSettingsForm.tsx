import { type FormEvent, type ReactNode, useEffect, useState } from "react";
import * as api from "../api";
import { type GuildSettings, type GuildSettingsResponse, SETTING_LIMITS } from "../shared";
import { useAction } from "../useAction";

/** A server's settings page (DJ role, volume, limits...). Only shown to server admins; the bot checks again. */
export function GuildSettingsForm({ guildId }: { guildId: string }) {
  const [loaded, setLoaded] = useState<GuildSettingsResponse | null>(null);
  /** The settings as edited on the page, saved with the Save button. */
  const [draft, setDraft] = useState<GuildSettings | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);
  const { run, pending, error } = useAction();

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
      const response = await api.updateGuildSettings(guildId, draft!);
      setLoaded(response);
      setDraft(response.settings);
      setJustSaved(true);
    });
  }

  const hasChanges = JSON.stringify(draft) !== JSON.stringify(loaded.settings);
  const everyoneRoleId = guildId; // Discord gives the @everyone role the server's id
  const namedRoles = loaded.roles.filter((role) => role.id !== everyoneRoleId);

  return (
    <form className="card settings" onSubmit={save}>
      <h3>Server settings</h3>

      <Field
        label="DJ role"
        hint="DJs control playback: add songs, skip, pause, change the volume and so on. Everyone else can only look. Server admins can always do everything."
      >
        <select value={draft.djRoleId ?? ""} onChange={(event) => change("djRoleId", event.target.value || null)}>
          <option value="">No DJ role: only admins control playback</option>
          <option value={everyoneRoleId}>@everyone: every member is a DJ</option>
          {namedRoles.map((role) => (
            <option key={role.id} value={role.id}>
              {role.name}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Only from the bot's voice channel" hint="While the bot is in a voice channel, DJs must be in it too to control playback. Admins don't.">
        <label className="checkbox">
          <input
            type="checkbox"
            checked={draft.requireSameVoiceChannel}
            onChange={(event) => change("requireSameVoiceChannel", event.target.checked)}
          />
          Required
        </label>
      </Field>

      <Field label="Starting volume" hint="The volume the bot starts at when it joins a voice channel (100% is normal).">
        <NumberInput
          value={draft.defaultVolume}
          limits={SETTING_LIMITS.defaultVolume}
          unit="%"
          onChange={(value) => change("defaultVolume", value ?? draft.defaultVolume)}
        />
      </Field>

      <Field label="Queue limit" hint="The most songs that can wait in the queue. Empty = no limit.">
        <NumberInput
          value={draft.maxQueueLength}
          limits={SETTING_LIMITS.maxQueueLength}
          unit="songs"
          placeholder="no limit"
          onChange={(value) => change("maxQueueLength", value)}
        />
      </Field>

      <Field label="Longest song" hint="Longer songs can't be added. Livestreams are always allowed. Empty = no limit.">
        <NumberInput
          // Shown in minutes, stored in seconds.
          value={draft.maxTrackDurationSec === null ? null : Math.round(draft.maxTrackDurationSec / 60)}
          limits={{ min: 1, max: SETTING_LIMITS.maxTrackDurationSec.max / 60 }}
          unit="minutes"
          placeholder="no limit"
          onChange={(minutes) => change("maxTrackDurationSec", minutes === null ? null : minutes * 60)}
        />
      </Field>

      <Field label="Leave an empty channel after" hint="When nobody is left listening, the bot stops and leaves after this long. 0 = never leave.">
        <NumberInput
          value={draft.leaveWhenEmptyAfterSec}
          limits={SETTING_LIMITS.leaveWhenEmptyAfterSec}
          unit="seconds"
          onChange={(value) => change("leaveWhenEmptyAfterSec", value ?? draft.leaveWhenEmptyAfterSec)}
        />
      </Field>

      <Field label="Announce songs in" hint="The bot posts “Now playing …” in this channel whenever a new song starts.">
        <select value={draft.announceChannelId ?? ""} onChange={(event) => change("announceChannelId", event.target.value || null)}>
          <option value="">Don't announce</option>
          {loaded.textChannels.map((channel) => (
            <option key={channel.id} value={channel.id}>
              #{channel.name}
            </option>
          ))}
        </select>
      </Field>

      <div className="save-row">
        <button type="submit" className="primary" disabled={pending || !hasChanges}>
          {pending ? "Saving…" : "Save"}
        </button>
        {justSaved && !hasChanges && <span className="muted">Saved. Changes apply right away.</span>}
        {error && <span className="error-text">{error}</span>}
      </div>
    </form>
  );
}

/** One setting: a label, the input, and a line explaining it. */
export function Field({ label, hint, children }: { label: string; hint: string; children: ReactNode }) {
  return (
    <div className="field">
      <span className="field-label">{label}</span>
      <div className="field-input">{children}</div>
      <p className="muted field-hint">{hint}</p>
    </div>
  );
}

interface NumberInputProps {
  value: number | null;
  limits: { min: number; max: number };
  unit: string;
  /** Shown when empty. Only settings that may be empty ("no limit") have one; for them, emptying the box sends null. */
  placeholder?: string;
  onChange: (value: number | null) => void;
}

/** A whole-number input. The browser stops numbers outside `limits`; the bot checks them again when saving. */
function NumberInput({ value, limits, unit, placeholder, onChange }: NumberInputProps) {
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
        type="number"
        min={limits.min}
        max={limits.max}
        step={1}
        value={text}
        placeholder={placeholder}
        onChange={(event) => edit(event.target.value)}
      />
      <span className="muted">{unit}</span>
    </label>
  );
}
