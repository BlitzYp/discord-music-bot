import * as api from "../api";
import { type PlayerSnapshot, playbackRate } from "../shared";
import { useNow } from "../useNow";
import { PlayerControls } from "./PlayerControls";
import { SeekBar } from "./SeekBar";

interface Props {
  guildId: string;
  snapshot: PlayerSnapshot;
  /** When `snapshot.positionMs` was received; the position keeps counting up from there while playing. */
  receivedAt: number;
  /** Whether the user is a DJ (shows the controls). */
  canControl: boolean;
}

/** The current track: artwork, title, who asked for it, the progress bar, and (for DJs) the controls. */
export function NowPlaying({ guildId, snapshot, receivedAt, canControl }: Props) {
  const now = useNow(500);
  const item = snapshot.current;

  if (!item) {
    return (
      <section className="card now-playing empty">
        <p>Nothing is playing.</p>
        <p className="muted">{canControl ? "Add a link above, or use /play in Discord." : "Use /play in Discord to start some music."}</p>
      </section>
    );
  }

  // The bot sends the position about once a second; in between, count up from the last value.
  // Nightcore and vaporwave play the song faster or slower, so the bar has to move faster or slower too.
  const elapsedSinceUpdate = snapshot.paused ? 0 : (now - receivedAt) * playbackRate(snapshot.filter);
  const position = Math.min(snapshot.positionMs + elapsedSinceUpdate, item.durationMs ?? Infinity);
  const link = item.source.kind === "file" ? undefined : item.source.url;

  return (
    <section className="card now-playing">
      <div className="track">
        {item.thumbnail ? <img className="artwork" src={item.thumbnail} alt="" /> : <div className="artwork placeholder">♪</div>}

        <div className="details">
          <p className="label">{snapshot.interrupted ? "Stopped by a restart" : snapshot.paused ? "Paused" : "Now playing"}</p>
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

          <SeekBar
            positionMs={position}
            durationMs={item.durationMs}
            isStream={item.isStream}
            canSeek={canControl && !item.isStream && !snapshot.interrupted}
            onSeek={async (positionMs) => {
              await api.seek(guildId, positionMs).catch(() => {}); // a failed seek just snaps back
            }}
          />

          {snapshot.interrupted && (
            <p className="hint">
              The bot restarted while this was playing. {canControl ? "Press Resume" : "A DJ can use /resume"} to continue from
              here (the bot joins {canControl ? "your" : "their"} voice channel).
            </p>
          )}

          <ul className="badges">
            <li>Volume {snapshot.volume}%</li>
            {snapshot.loopMode !== "off" && <li>Looping {snapshot.loopMode}</li>}
            {snapshot.filter !== "off" && <li className="effect">Effect: {snapshot.filter}</li>}
          </ul>
        </div>
      </div>

      {canControl && <PlayerControls guildId={guildId} snapshot={snapshot} />}
    </section>
  );
}
