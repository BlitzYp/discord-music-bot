import * as api from "../api";
import { AUDIO_FILTERS, type AudioFilter, FILTER_DESCRIPTIONS } from "../shared";
import { useAction } from "../useAction";

interface Props {
  guildId: string;
  /** The effect that's on right now; it's highlighted. */
  active: AudioFilter;
  /** Whether the user is a DJ. Others see the effects but can't pick one. */
  canControl: boolean;
  /** Effects can only be changed while the bot is in a voice channel. */
  inVoice: boolean;
}

/** Buttons for the audio effects, the same ones /filter offers in Discord. */
export function EffectPicker({ guildId, active, canControl, inVoice }: Props) {
  const { run, pending, error } = useAction();
  const disabled = !canControl || !inVoice || pending;

  return (
    <details className="audio-effects">
      <summary>
        Audio effects <span className={active === "off" ? "muted" : "effect-status"}>{active === "off" ? "Off" : active}</span>
      </summary>
      <div className="effects">
        {AUDIO_FILTERS.map((filter) => (
          <button
            key={filter}
            type="button"
            className={filter === active ? "active" : undefined}
            aria-pressed={filter === active}
            aria-description={FILTER_DESCRIPTIONS[filter]}
            title={FILTER_DESCRIPTIONS[filter]}
            disabled={disabled}
            // No need to use the answer: the socket's player:update moves the highlight, the same way it does
            // when someone uses /filter in Discord.
            onClick={() => run(() => api.setFilter(guildId, filter))}
          >
            {filter}
          </button>
        ))}
      </div>
      {canControl && !inVoice && <p className="muted hint">Effects can be changed while the bot is in a voice channel.</p>}
      {!canControl && <p className="muted hint">Only DJs can change the effect.</p>}
      {error && <p className="hint error-text">{error}</p>}
    </details>
  );
}
