import { type CSSProperties, useState } from "react";
import * as api from "../api";
import { type LoopMode, MAX_VOLUME, type PlayerSnapshot } from "../shared";
import { useAction } from "../useAction";

interface Props {
  guildId: string;
  snapshot: PlayerSnapshot;
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
      <div className="buttons">
        {snapshot.paused ? (
          <button type="button" disabled={!playing || pending} onClick={() => run(() => api.resume(guildId))}>
            ▶ Resume
          </button>
        ) : (
          <button type="button" disabled={!playing || pending} onClick={() => run(() => api.pause(guildId))}>
            ⏸ Pause
          </button>
        )}
        <button type="button" disabled={!playing || pending} onClick={() => run(() => api.skip(guildId))}>
          ⏭ Skip
        </button>
        <button type="button" disabled={!active || pending} onClick={stop}>
          ⏹ Stop
        </button>

        <label className="loop">
          Loop
          <select
            value={snapshot.loopMode}
            disabled={!active || pending}
            onChange={(event) => run(() => api.setLoopMode(guildId, event.target.value as LoopMode))}
          >
            <option value="off">off</option>
            <option value="track">this track</option>
            <option value="queue">the queue</option>
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
      🔊
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
