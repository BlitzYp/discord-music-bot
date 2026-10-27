import { type ReactNode, useId, useRef, useState } from "react";
import * as api from "../api";
import { formatDuration, type QueueItem } from "../shared";
import { useAction } from "../useAction";
import { useDragReorder } from "../useDragReorder";
import { SaveQueuePlaylist } from "./SaveQueuePlaylist";
import { SongTitle } from "./SongTitle";
import { TrackArtwork } from "./TrackArtwork";

interface Props {
  guildId: string;
  queue: QueueItem[];
  /** The queue-save action also includes the currently playing song. */
  hasCurrentTrack: boolean;
  /** Whether the user is a DJ (shows the play now/move/remove buttons, Shuffle and Clear, and allows dragging). */
  canControl: boolean;
  /** The add-song form lives with the queue; members don't get one. */
  children?: ReactNode;
}

/** The tracks waiting to play, numbered like /queue in Discord. DJs can drag them to reorder. */
export function QueueList({ guildId, queue, hasCurrentTrack, canControl, children }: Props) {
  const saveFormId = useId();
  const saveButtonRef = useRef<HTMLButtonElement>(null);
  const [saveFormOpen, setSaveFormOpen] = useState(false);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);
  const totalSongs = queue.length + (hasCurrentTrack ? 1 : 0);
  const { run, pending, error } = useAction();
  const { rowProps } = useDragReorder(queue, (item, position) => run(() => api.moveInQueue(guildId, item.id, position)), {
    enabled: canControl && !pending,
  });

  const totalMs = queue.reduce((sum, item) => sum + (item.durationMs ?? 0), 0);

  function closeSaveForm() {
    setSaveFormOpen(false);
    saveButtonRef.current?.focus();
  }

  function clear() {
    // Can't be undone, so ask first. The current track keeps playing.
    const count = queue.length === 1 ? "the 1 track" : `all ${queue.length} tracks`;
    if (confirm(`Remove ${count} from the queue? The current track keeps playing.`)) void run(() => api.clearQueue(guildId));
  }

  return (
    <section className="queue-section" aria-label="Up next">
      <div className="section-heading">
        <div>
          <h3>Up next</h3>
          <p className="muted section-meta">
            {queue.length} {queue.length === 1 ? "track" : "tracks"} · {formatDuration(totalMs)}
          </p>
        </div>
        {canControl && (
          <div className="queue-heading-actions">
            <button
              ref={saveButtonRef}
              type="button"
              className="small queue-save-button"
              title="Save the current song and queue as a playlist"
              aria-expanded={saveFormOpen}
              aria-controls={saveFormId}
              disabled={totalSongs === 0}
              onClick={() => {
                setSavedMessage(null);
                setSaveFormOpen(true);
              }}
            >
              Save as playlist
            </button>
            {queue.length > 1 && (
              <button type="button" className="small" disabled={pending} onClick={() => run(() => api.shuffleQueue(guildId))}>
                Shuffle
              </button>
            )}
            {queue.length > 0 && (
              <button type="button" className="small" disabled={pending} onClick={clear}>
                Clear
              </button>
            )}
          </div>
        )}
      </div>

      {canControl && saveFormOpen && (
        <SaveQueuePlaylist
          id={saveFormId}
          guildId={guildId}
          songCount={totalSongs}
          hasCurrentTrack={hasCurrentTrack}
          onCancel={closeSaveForm}
          onSaved={(playlist) => {
            setSavedMessage(`Saved “${playlist.name}” with ${playlist.songCount} ${playlist.songCount === 1 ? "song" : "songs"}. Find it on the Playlists tab.`);
            closeSaveForm();
          }}
        />
      )}
      {savedMessage && <p className="hint queue-save-status" role="status">{savedMessage}</p>}
      {children}
      {queue.length === 0 && <p className="muted empty-queue">No songs queued. Add a link or pick a saved playlist.</p>}

      <ol className="queue queue-scroll" aria-label="Queued songs" tabIndex={queue.length > 0 ? 0 : undefined}>
        {queue.map((item, index) => {
          const position = index + 1; // 1 = next, like in Discord
          return (
            <li key={item.id} {...rowProps(item, index)}>
              <span className="position">{position}</span>
              <TrackArtwork className="thumb" src={item.thumbnail} />
              <span className="info">
                <SongTitle className="title" title={item.title} source={item.source} />
                <span className="muted">
                  {item.author ? `${item.author} · ` : ""}
                  {item.requestedBy.name}
                </span>
              </span>
              <span className="duration">{formatDuration(item.durationMs, item.isStream)}</span>

              {canControl && (
                <span className="row-actions">
                  <button
                    type="button"
                    title="Play now (skips the current song)"
                    aria-label={`Play ${item.title} now`}
                    disabled={pending}
                    onClick={() => run(() => api.playNowFromQueue(guildId, item.id))}
                  >
                    ▶
                  </button>
                  <button
                    type="button"
                    title="Move up"
                    aria-label={`Move ${item.title} up`}
                    disabled={pending || position === 1}
                    onClick={() => run(() => api.moveInQueue(guildId, item.id, position - 1))}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    title="Move down"
                    aria-label={`Move ${item.title} down`}
                    disabled={pending || position === queue.length}
                    onClick={() => run(() => api.moveInQueue(guildId, item.id, position + 1))}
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    title="Remove"
                    aria-label={`Remove ${item.title}`}
                    disabled={pending}
                    onClick={() => run(() => api.removeFromQueue(guildId, item.id))}
                  >
                    ✕
                  </button>
                </span>
              )}
            </li>
          );
        })}
      </ol>
      {error && <p className="hint error-text">{error}</p>}
    </section>
  );
}
