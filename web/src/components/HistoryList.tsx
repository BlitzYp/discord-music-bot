import * as api from "../api";
import { formatDuration, type QueueItem } from "../shared";
import { useAction } from "../useAction";
import { SongTitle } from "./SongTitle";
import { TrackArtwork } from "./TrackArtwork";

interface Props {
  guildId: string;
  history: QueueItem[];
  /** Whether the user is a DJ (shows the add-to-queue action and Clear). */
  canControl: boolean;
}

/** Recently played tracks, newest first. DJs can add one to the queue again. */
export function HistoryList({ guildId, history, canControl }: Props) {
  const { run, pending, error } = useAction();
  if (history.length === 0) return null;

  function clear() {
    if (confirm("Clear the recently played list?")) void run(() => api.clearHistory(guildId));
  }

  return (
    <section className="history-section" aria-label="Recently played">
      <div className="section-heading">
        <h3>Recently played</h3>
        {canControl && (
          <button type="button" className="small" disabled={pending} onClick={clear}>
            Clear
          </button>
        )}
      </div>
      <ol className="queue history">
        {history.map((item) => {
          // Re-adding works by link, the same as pasting it into "Add a song". (Library files come in milestone 8.)
          const link = item.source.kind === "file" ? null : item.source.url;
          return (
            <li key={item.id}>
              <TrackArtwork className="thumb" src={item.thumbnail} />
              <span className="info">
                <SongTitle className="title" title={item.title} source={item.source} />
                <span className="muted">
                  {item.author ? `${item.author} · ` : ""}
                  {item.requestedBy.name}
                </span>
              </span>
              <span className="duration">{formatDuration(item.durationMs, item.isStream)}</span>
              {canControl && link && (
                <span className="row-actions">
                  <button
                    type="button"
                    title="Add to queue"
                    aria-label={`Add ${item.title} to queue`}
                    disabled={pending}
                    onClick={() => run(() => api.addToQueue(guildId, link))}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true" focusable="false">
                      <path d="M12 5v14M5 12h14" strokeLinecap="round" />
                    </svg>
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
