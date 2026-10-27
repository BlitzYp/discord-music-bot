// The voices the bot can speak with (Piper, see src/tts/). The bot owner downloads the ones they want on the Admin page;
// each server picks one of the downloaded voices on its Settings page.

export type VoiceLanguage = "en" | "de" | "lv";

export interface Voice {
  /** Piper's name for the voice, which is also its file name: bin/piper/voices/<id>.onnx. */
  id: string;
  /** The name shown on the website. */
  name: string;
  /** Who it sounds like, e.g. "Woman, American English". */
  description: string;
  language: VoiceLanguage;
  /** The download size, roughly. */
  sizeMb: number;
}

/**
 * The voices on offer: picked from Piper's collection (https://rhasspy.github.io/piper-samples/), one speaker each and
 * the "medium" quality where there is one. A voice whose name isn't on this list can never be downloaded or used, so
 * nobody can make the bot fetch arbitrary files.
 */
export const VOICES: readonly Voice[] = [
  { id: "en_US-lessac-medium", name: "Lessac", description: "Woman, American English", language: "en", sizeMb: 63 },
  { id: "en_US-amy-medium", name: "Amy", description: "Woman, American English", language: "en", sizeMb: 63 },
  { id: "en_US-ryan-medium", name: "Ryan", description: "Man, American English", language: "en", sizeMb: 63 },
  { id: "en_US-joe-medium", name: "Joe", description: "Man, American English", language: "en", sizeMb: 63 },
  { id: "en_GB-jenny_dioco-medium", name: "Jenny", description: "Woman, British English", language: "en", sizeMb: 63 },
  { id: "en_GB-alan-medium", name: "Alan", description: "Man, British English", language: "en", sizeMb: 63 },
  {
    id: "en_GB-northern_english_male-medium",
    name: "Northern English",
    description: "Man, Northern English",
    language: "en",
    sizeMb: 63,
  },
  { id: "de_DE-thorsten-medium", name: "Thorsten", description: "Man, German", language: "de", sizeMb: 63 },
  // Piper has no German woman's voice in medium quality; "low" sounds a little rougher.
  { id: "de_DE-kerstin-low", name: "Kerstin", description: "Woman, German (lower quality)", language: "de", sizeMb: 63 },
  { id: "lv_LV-aivars-medium", name: "Aivars", description: "Man, Latvian", language: "lv", sizeMb: 64 },
];

/** The voice `npm run setup:piper` downloads, used when a server hasn't picked one (or its voice was deleted). */
export const DEFAULT_VOICE_ID = "en_US-lessac-medium";

export const LANGUAGE_NAMES: Record<VoiceLanguage, string> = { en: "English", de: "German", lv: "Latvian" };

/** How fast the bot speaks: 1 is the voice's normal speed, 2 twice as fast. */
export const SPEECH_SPEED_LIMITS = { min: 0.5, max: 2, step: 0.05 } as const;

export function findVoice(id: string): Voice | undefined {
  return VOICES.find((voice) => voice.id === id);
}

/** A voice and whether it's on the bot's PC (GET /admin/voices). */
export interface VoiceStatus extends Voice {
  downloaded: boolean;
  /** Being downloaded right now. */
  downloading: boolean;
}
