import { formatDuration, type QueueItem } from "../shared";

/** The tracks waiting to play, numbered like /queue in Discord. */
export function QueueList({ queue }: { queue: QueueItem[] }) {
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
      <h3>
        Up next{" "}
        <span className="muted">
          · {queue.length} {queue.length === 1 ? "track" : "tracks"} · {formatDuration(totalMs)}
        </span>
      </h3>
      <ol className="queue">
        {queue.map((item, index) => (
          <li key={item.id}>
            <span className="position">{index + 1}</span>
            {item.thumbnail ? <img src={item.thumbnail} alt="" /> : <span className="thumb placeholder">♪</span>}
            <span className="info">
              <span className="title">{item.title}</span>
              <span className="muted">
                {item.author ? `${item.author} · ` : ""}
                {item.requestedBy.name}
              </span>
            </span>
            <span className="duration">{formatDuration(item.durationMs, item.isStream)}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
