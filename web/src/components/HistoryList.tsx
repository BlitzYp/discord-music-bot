import * as api from "../api";
import { formatDuration, type QueueItem } from "../shared";
import { useAction } from "../useAction";

interface Props {
  guildId: string;
  history: QueueItem[];
  /** Whether the user is a DJ (shows "Play again" and Clear). */
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
    <section className="card">
      <h3 className="with-action">
        <span>Recently played</span>
        {canControl && (
          <button type="button" className="small" disabled={pending} onClick={clear}>
            🗑 Clear
          </button>
        )}
      </h3>
      <ol className="queue history">
        {history.map((item) => {
          // Re-adding works by link, the same as pasting it into "Add a song". (Library files come in milestone 8.)
          const link = item.source.kind === "file" ? null : item.source.url;
          return (
            <li key={item.id}>
              {item.thumbnail ? <img src={item.thumbnail} alt="" /> : <span className="thumb placeholder">♪</span>}
              <span className="info">
                <span className="title">{item.title}</span>
                <span className="muted">
                  {item.author ? `${item.author} · ` : ""}
                  {item.requestedBy.name}
                </span>
              </span>
              <span className="duration">{formatDuration(item.durationMs, item.isStream)}</span>
              {canControl && link && (
                <span className="row-actions">
                  <button type="button" className="small" disabled={pending} onClick={() => run(() => api.addToQueue(guildId, link))}>
                    ↺ Play again
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
