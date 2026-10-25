import * as api from "../api";
import { formatDuration, type QueueItem } from "../shared";
import { useAction } from "../useAction";

interface Props {
  guildId: string;
  queue: QueueItem[];
  /** Whether the user is a DJ (shows the move/remove buttons and Shuffle). */
  canControl: boolean;
}

/** The tracks waiting to play, numbered like /queue in Discord. */
export function QueueList({ guildId, queue, canControl }: Props) {
  const { run, pending, error } = useAction();

  if (queue.length === 0) {
    return (
      <section className="card">
        <h3>Up next</h3>
        <p className="muted">The queue is empty.</p>
      </section>
    );
  }

  const totalMs = queue.reduce((sum, item) => sum + (item.durationMs ?? 0), 0);

  return (
    <section className="card">
      <h3 className="with-action">
        <span>
          Up next{" "}
          <span className="muted">
            · {queue.length} {queue.length === 1 ? "track" : "tracks"} · {formatDuration(totalMs)}
          </span>
        </span>
        {canControl && queue.length > 1 && (
          <button type="button" className="small" disabled={pending} onClick={() => run(() => api.shuffleQueue(guildId))}>
            🔀 Shuffle
          </button>
        )}
      </h3>

      <ol className="queue">
        {queue.map((item, index) => {
          const position = index + 1; // 1 = next, like in Discord
          return (
            <li key={item.id}>
              <span className="position">{position}</span>
              {item.thumbnail ? <img src={item.thumbnail} alt="" /> : <span className="thumb placeholder">♪</span>}
              <span className="info">
                <span className="title">{item.title}</span>
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
