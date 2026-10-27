import { useRef, useState } from "react";
import * as api from "../api";
import { DEFAULT_VOICE_ID, SPEECH_SPEED_LIMITS, type Voice } from "../shared";
import { Field } from "./GuildSettingsForm";

interface Props {
  guildId: string;
  /** The voices the server can pick: the downloaded ones. */
  voices: Voice[];
  voiceId: string | null;
  speed: number;
  onVoiceChange: (voiceId: string) => void;
  onSpeedChange: (speed: number) => void;
}

/**
 * The Settings page's voice and speaking speed for announcements, with a Listen button that plays a sample in the
 * browser (not in the voice channel).
 */
export function VoiceFields({ guildId, voices, voiceId, speed, onVoiceChange, onSpeedChange }: Props) {
  // A voice that was deleted (or none picked) means the default voice; show that.
  const shownVoiceId = voices.some((voice) => voice.id === voiceId) ? voiceId! : DEFAULT_VOICE_ID;
  const [listenState, setListenState] = useState<"idle" | "loading" | "playing">("idle");
  const [listenError, setListenError] = useState<string | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);

  async function listen() {
    audio.current?.pause();
    setListenError(null);
    setListenState("loading");
    // Making the sample takes a second or two; the browser fetches and plays it.
    const sample = new Audio(api.voiceSampleUrl(guildId, shownVoiceId, speed));
    audio.current = sample;
    sample.onplaying = () => setListenState("playing");
    sample.onended = () => setListenState("idle");
    sample.onerror = () => {
      setListenState("idle");
      setListenError("Couldn't play the sample. Is the voice still downloaded?");
    };
    await sample.play().catch(() => {}); // a failure shows up through onerror
  }

  return (
    <>
      <Field
        inputId="announcement-voice"
        label="Voice"
        hint="Write messages in the voice's language; they aren't translated. More voices are available from the bot owner."
      >
        <div className="voice-picker">
          <select id="announcement-voice" value={shownVoiceId} onChange={(event) => onVoiceChange(event.target.value)}>
            {voices.map((voice) => (
              <option key={voice.id} value={voice.id}>
                {voice.name} ({voice.description})
              </option>
            ))}
          </select>
          <button type="button" className="small" onClick={listen} disabled={listenState !== "idle" || voices.length === 0}>
            {listenState === "loading" ? "Loading…" : listenState === "playing" ? "Playing…" : "▶ Listen"}
          </button>
        </div>
        {listenError && <p className="hint error-text">{listenError}</p>}
      </Field>

      <Field inputId="speaking-speed" label="Speaking speed" hint="1× is normal. Listen previews the selected speed.">
        <label className="speed-input">
          <input
            id="speaking-speed"
            className="slider"
            type="range"
            min={SPEECH_SPEED_LIMITS.min}
            max={SPEECH_SPEED_LIMITS.max}
            step={SPEECH_SPEED_LIMITS.step}
            value={speed}
            aria-label="Speaking speed"
            onChange={(event) => onSpeedChange(Number(event.target.value))}
          />
          <span className="muted">{speed.toFixed(2)}×</span>
        </label>
      </Field>
    </>
  );
}
