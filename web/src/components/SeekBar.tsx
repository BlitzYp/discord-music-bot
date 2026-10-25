import { type CSSProperties, useState } from "react";
import { formatDuration } from "../shared";

interface Props {
  positionMs: number;
  durationMs: number | undefined;
  isStream: boolean | undefined;
  /** Whether the user may seek (DJ) and the track allows it. Otherwise this is a plain progress bar. */
  canSeek: boolean;
  onSeek: (positionMs: number) => Promise<void>;
}

/**
 * The progress bar. For DJs it's a slider: dragging shows where you'll land, and letting go seeks there.
 * Seeking only happens on release, not on every pixel of the drag.
 */
export function SeekBar({ positionMs, durationMs, isStream, canSeek, onSeek }: Props) {
  /** Where the slider is while being dragged (or until the seek finishes); null = follow the playback position. */
  const [dragMs, setDragMs] = useState<number | null>(null);
  const shownMs = dragMs ?? positionMs;
  const percent = durationMs ? (shownMs / durationMs) * 100 : 0;

  async function commit() {
    if (dragMs === null) return;
    await onSeek(dragMs);
    setDragMs(null);
  }

  return (
    <div className="progress">
      <span>{formatDuration(shownMs)}</span>
      {canSeek && durationMs ? (
        <input
          type="range"
          className="slider"
          aria-label="Position in the song"
          min={0}
          max={durationMs}
          step={1000}
          value={shownMs}
          style={{ "--fill": `${percent}%` } as CSSProperties}
          onChange={(event) => setDragMs(Number(event.target.value))}
          onPointerUp={commit}
          onKeyUp={commit}
        />
      ) : (
        <div className="bar" role="progressbar" aria-valuenow={Math.round(percent)}>
          <div className="fill" style={{ width: `${percent}%` }} />
        </div>
      )}
      <span>{formatDuration(durationMs, isStream)}</span>
    </div>
  );
}
