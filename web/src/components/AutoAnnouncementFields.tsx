import type { ReactNode } from "react";
import {
  AUTO_ANNOUNCEMENT_WORDS,
  type AutoAnnouncement,
  type AutoAnnouncementKind,
  type AutoAnnouncements,
  MAX_AUTO_ANNOUNCEMENT_MESSAGE_LENGTH,
  SONG_START_WHEN,
  type SongStartWhen,
} from "../shared";

const LABELS: Record<AutoAnnouncementKind, { label: string; hint: string }> = {
  songStart: { label: "Before a song", hint: "Said just before the song starts. A song on repeat is announced once." },
  playlistStart: { label: "When a playlist starts", hint: "Said before the first song when a DJ plays a saved playlist." },
  memberJoin: {
    label: "When someone joins",
    hint: "When someone joins the bot's voice channel. People joining together are named together.",
  },
  memberLeave: { label: "When someone leaves", hint: "When someone leaves the bot's voice channel." },
};

const SONG_START_WHEN_LABELS: Record<SongStartWhen, string> = {
  "every-song": "Every song",
  "first-song": "Only when the music starts (after nothing was playing)",
};

interface Props {
  value: AutoAnnouncements;
  onChange: (value: AutoAnnouncements) => void;
}

/**
 * The Settings page's automatic announcements: what the bot says by itself in the voice channel, and when.
 * Each one has an on/off switch and its own message.
 */
export function AutoAnnouncementFields({ value, onChange }: Props) {
  function change<K extends AutoAnnouncementKind>(kind: K, changes: Partial<AutoAnnouncements[K]>) {
    onChange({ ...value, [kind]: { ...value[kind], ...changes } });
  }

  return (
    <>
      {(Object.keys(LABELS) as AutoAnnouncementKind[]).map((kind) => (
        <AutoAnnouncementField key={kind} kind={kind} announcement={value[kind]} onChange={(changes) => change(kind, changes)}>
          {kind === "songStart" && (
            <select
              value={value.songStart.when}
              disabled={!value.songStart.enabled}
              aria-label="When to announce songs"
              onChange={(event) => change("songStart", { when: event.target.value as SongStartWhen })}
            >
              {SONG_START_WHEN.map((when) => (
                <option key={when} value={when}>
                  {SONG_START_WHEN_LABELS[when]}
                </option>
              ))}
            </select>
          )}
        </AutoAnnouncementField>
      ))}
    </>
  );
}

interface FieldProps {
  kind: AutoAnnouncementKind;
  announcement: AutoAnnouncement;
  onChange: (changes: Partial<AutoAnnouncement>) => void;
  /** Extra inputs for this announcement (the song-start one's "when"). */
  children?: ReactNode;
}

function AutoAnnouncementField({ kind, announcement, onChange, children }: FieldProps) {
  const { label, hint } = LABELS[kind];
  const words = AUTO_ANNOUNCEMENT_WORDS[kind].map((word) => `{${word}}`).join(", ");
  return (
    <div className="auto-announcement">
      <div className="auto-announcement-heading">
        <div>
          <label className="field-label" htmlFor={`announcement-${kind}`}>{label}</label>
          <p className="muted hint">{hint}</p>
        </div>
        <label className="switch">
          <input
            id={`announcement-${kind}`}
            type="checkbox"
            aria-label={label}
            checked={announcement.enabled}
            onChange={(event) => onChange({ enabled: event.target.checked })}
          />
          <span aria-hidden="true">{announcement.enabled ? "On" : "Off"}</span>
        </label>
      </div>
      {announcement.enabled && (
        <div className="auto-announcement-message">
          <label className="field-label" htmlFor={`message-${kind}`}>Message</label>
          <textarea
            id={`message-${kind}`}
            aria-label={`${label}: what the bot says`}
            aria-describedby={`words-${kind}`}
            rows={2}
            value={announcement.message}
            maxLength={MAX_AUTO_ANNOUNCEMENT_MESSAGE_LENGTH}
            onChange={(event) => onChange({ message: event.target.value })}
          />
          <p className="muted hint" id={`words-${kind}`}>Filled in automatically: {words}.</p>
          {children}
        </div>
      )}
    </div>
  );
}
