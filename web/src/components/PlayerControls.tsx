import { type CSSProperties, useState } from "react";
import * as api from "../api";
import { type LoopMode, MAX_VOLUME, type PlayerSnapshot } from "../shared";
import { useAction } from "../useAction";

interface Props {
  guildId: string;
  snapshot: PlayerSnapshot;
}

const ICON_PATHS = {
  resume: "M8 5v14l11-7z",
  pause: "M6 5h4v14H6zm8 0h4v14h-4z",
  skip: "M5 5v14l10-7zm12 0h2v14h-2z",
  stop: "M6 6h12v12H6z",
  volume: "M3 9v6h4l5 5V4L7 9H3zm13 3a5 5 0 0 0-2-4v8a5 5 0 0 0 2-4z",
};

function PlaybackIcon({ name }: { name: keyof typeof ICON_PATHS }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
      <path d={ICON_PATHS[name]} />
    </svg>
  );
}

/** Pause/resume, skip, stop, loop mode and volume. Only shown to DJs. */
export function PlayerControls({ guildId, snapshot }: Props) {
  const { run, pending, error } = useAction();
  const playing = snapshot.current !== null;
  // After a restart the bot isn't in voice yet, but the interrupted song can still be stopped or looped.
  const active = snapshot.voiceChannelId !== null || snapshot.interrupted;

  function stop() {
    // Stopping clears the whole queue, so ask first.
    if (confirm("Stop playback, clear the queue and leave the voice channel?")) void run(() => api.stop(guildId));
  }

  return (
    <div className="controls">
      <div className="buttons transport-controls">
        {snapshot.paused ? (
          <button type="button" className="primary" disabled={!playing || pending} onClick={() => run(() => api.resume(guildId))}>
            <PlaybackIcon name="resume" /> Resume
          </button>
        ) : (
          <button type="button" className="primary" disabled={!playing || pending} onClick={() => run(() => api.pause(guildId))}>
            <PlaybackIcon name="pause" /> Pause
          </button>
        )}
        <button type="button" disabled={!playing || pending} onClick={() => run(() => api.skip(guildId))}>
          <PlaybackIcon name="skip" /> Skip
        </button>
        <button type="button" disabled={!active || pending} onClick={stop}>
          <PlaybackIcon name="stop" /> Stop
        </button>
      </div>
      <div className="playback-options">
        <label className="loop">
          Loop
          <select
            value={snapshot.loopMode}
            disabled={!active || pending}
            onChange={(event) => run(() => api.setLoopMode(guildId, event.target.value as LoopMode))}
          >
            <option value="off">Off</option>
            <option value="track">Track</option>
            <option value="queue">Queue</option>
          </select>
        </label>

        <VolumeSlider
          volume={snapshot.volume}
          disabled={!snapshot.voiceChannelId}
          onChange={(volume) => run(() => api.setVolume(guildId, volume))}
        />
      </div>
      {error && <p className="hint error-text">{error}</p>}
    </div>
  );
}

/** A volume slider that only sends the new volume when you let go. */
function VolumeSlider(props: { volume: number; disabled: boolean; onChange: (volume: number) => Promise<void> }) {
  const [dragValue, setDragValue] = useState<number | null>(null);
  const shown = dragValue ?? props.volume;

  async function commit() {
    if (dragValue === null) return;
    await props.onChange(dragValue);
    setDragValue(null);
  }

  return (
    <label className="volume">
      <PlaybackIcon name="volume" />
      <span className="visually-hidden">Volume</span>
      <input
        type="range"
        className="slider"
        aria-label="Volume"
        min={0}
        max={MAX_VOLUME}
        value={shown}
        disabled={props.disabled}
        style={{ "--fill": `${(shown / MAX_VOLUME) * 100}%` } as CSSProperties}
        onChange={(event) => setDragValue(Number(event.target.value))}
        onPointerUp={commit}
        onKeyUp={commit}
      />
      <span className="volume-value">{shown}%</span>
    </label>
  );
}
