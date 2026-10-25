import { formatDuration, type PlayerSnapshot, playbackRate } from "../shared";
import { useNow } from "../useNow";

interface Props {
  snapshot: PlayerSnapshot;
  /** When `snapshot.positionMs` was received; the position keeps counting up from there while playing. */
  receivedAt: number;
}

/** The current track: artwork, title, who asked for it, a progress bar, and the player's settings. */
export function NowPlaying({ snapshot, receivedAt }: Props) {
  const now = useNow(500);
  const item = snapshot.current;

  if (!item) {
    return (
      <section className="card now-playing empty">
        <p>Nothing is playing.</p>
        <p className="muted">Use /play in Discord to start some music.</p>
      </section>
    );
  }

  // The bot sends the position about once a second; in between, count up from the last value.
  // Nightcore and vaporwave play the song faster or slower, so the bar has to move faster or slower too.
  const elapsedSinceUpdate = snapshot.paused ? 0 : (now - receivedAt) * playbackRate(snapshot.filter);
  const duration = item.durationMs;
  const position = Math.min(snapshot.positionMs + elapsedSinceUpdate, duration ?? Infinity);
  const progressPercent = duration ? (position / duration) * 100 : 0;
  const link = item.source.kind === "file" ? undefined : item.source.url;

  return (
    <section className="card now-playing">
      {item.thumbnail ? <img className="artwork" src={item.thumbnail} alt="" /> : <div className="artwork placeholder">♪</div>}

      <div className="details">
        <p className="label">{snapshot.paused ? "Paused" : "Now playing"}</p>
        <h2 className="title">
          {link ? (
            <a href={link} target="_blank" rel="noreferrer">
              {item.title}
            </a>
          ) : (
            item.title
          )}
        </h2>
        <p className="muted">
          {item.author ? `${item.author} · ` : ""}requested by {item.requestedBy.name}
        </p>

        <div className="progress">
          <span>{formatDuration(position)}</span>
          <div className="bar" role="progressbar" aria-valuenow={Math.round(progressPercent)}>
            <div className="fill" style={{ width: `${progressPercent}%` }} />
          </div>
          <span>{formatDuration(duration, item.isStream)}</span>
        </div>

        <ul className="badges">
          <li>Volume {snapshot.volume}%</li>
          {snapshot.loopMode !== "off" && <li>Looping {snapshot.loopMode}</li>}
          {snapshot.filter !== "off" && <li className="effect">Effect: {snapshot.filter}</li>}
        </ul>
      </div>
    </section>
  );
}
