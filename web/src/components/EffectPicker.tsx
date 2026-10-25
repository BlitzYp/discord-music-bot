import { useState } from "react";
import { setFilter } from "../api";
import { AUDIO_FILTERS, type AudioFilter, FILTER_DESCRIPTIONS } from "../shared";

interface Props {
  guildId: string;
  /** The effect that's on right now; it's highlighted. */
  active: AudioFilter;
  /** Effects can only be changed while the bot is in a voice channel. */
  disabled: boolean;
}

/** Buttons for the audio effects, the same ones /filter offers in Discord. */
export function EffectPicker({ guildId, active, disabled }: Props) {
  const [pending, setPending] = useState<AudioFilter | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function choose(filter: AudioFilter) {
    setPending(filter);
    setError(null);
    try {
      // No need to use the answer: the socket's player:update moves the highlight, the same way it does
      // when someone uses /filter in Discord.
      await setFilter(guildId, filter);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPending(null);
    }
  }

  return (
    <section className="card">
      <h3>
        Effects{" "}
        <span className="muted">· {active === "off" ? "none" : `${active}: ${FILTER_DESCRIPTIONS[active].toLowerCase()}`}</span>
      </h3>
      <div className="effects">
        {AUDIO_FILTERS.map((filter) => (
          <button
            key={filter}
            type="button"
            className={filter === active ? "active" : undefined}
            aria-pressed={filter === active}
            title={FILTER_DESCRIPTIONS[filter]}
            disabled={disabled || pending !== null}
            onClick={() => choose(filter)}
          >
            {pending === filter ? "…" : filter}
          </button>
        ))}
      </div>
      {disabled && <p className="muted hint">Play something in Discord first; effects apply while the bot is in a voice channel.</p>}
      {error && <p className="hint error-text">{error}</p>}
    </section>
  );
}
