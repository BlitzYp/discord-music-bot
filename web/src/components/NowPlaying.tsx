import * as api from "../api";
import { type PlayerSnapshot, playbackRate } from "../shared";
import { useNow } from "../useNow";
import { EffectPicker } from "./EffectPicker";
import { PlayerControls } from "./PlayerControls";
import { SeekBar } from "./SeekBar";
import { SongTitle } from "./SongTitle";
import { TrackArtwork } from "./TrackArtwork";

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
      <section className="card now-playing" aria-label="Now playing">
        <div className="empty-player">
          <p className="label">Now playing</p>
          <h2>Nothing playing yet</h2>
          <p className="muted">{canControl ? "Add a song below or choose a saved playlist." : "A DJ can add a song to start the music."}</p>
        </div>
        <EffectPicker guildId={guildId} active={snapshot.filter} canControl={canControl} inVoice={snapshot.voiceChannelId !== null} />
      </section>
    );
  }

  // The bot sends the position about once a second; in between, count up from the last value.
  // Nightcore and vaporwave play the song faster or slower, so the bar has to move faster or slower too.
  // The local clock can tick just before a new snapshot arrives: never count backwards from that update.
  const elapsedSinceUpdate = snapshot.paused ? 0 : Math.max(0, now - receivedAt) * playbackRate(snapshot.filter);
  const position = Math.min(snapshot.positionMs + elapsedSinceUpdate, item.durationMs ?? Infinity);

  return (
    <section className="card now-playing" aria-label="Now playing">
      <div className="track">
        <TrackArtwork className="artwork" src={item.thumbnail} />

        <div className="details">
          <div className="now-playing-heading">
            <p className="label">Now playing</p>
            <span className="playback-state" data-playing={!snapshot.paused && !snapshot.interrupted}>
              {snapshot.interrupted ? "Paused after restart" : snapshot.paused ? "Paused" : "Playing"}
            </span>
          </div>
          <h2 className="title">
            <SongTitle title={item.title} source={item.source} />
          </h2>
          {item.author && <p className="track-author">{item.author}</p>}
          <p className="muted requested-by">Requested by {item.requestedBy.name}</p>

          {!canControl && (
            <ul className="player-meta">
              <li>Volume {snapshot.volume}%</li>
              {snapshot.loopMode !== "off" && <li>Looping {snapshot.loopMode}</li>}
            </ul>
          )}
        </div>
      </div>

      <SeekBar
        positionMs={position}
        durationMs={item.durationMs}
        isStream={item.isStream}
        canSeek={canControl && !item.isStream && !snapshot.interrupted}
        onSeek={async (positionMs) => {
          await api.seek(guildId, positionMs).catch(() => {}); // a failed seek just snaps back
        }}
      />
      {canControl && <PlayerControls guildId={guildId} snapshot={snapshot} />}
      {snapshot.interrupted && (
        <p className="muted hint player-notice">
          {canControl ? "Resume to continue from here. Join a voice channel in Discord first." : "A DJ can resume this song in Discord."}
        </p>
      )}
      <EffectPicker guildId={guildId} active={snapshot.filter} canControl={canControl} inVoice={snapshot.voiceChannelId !== null} />
    </section>
  );
}
