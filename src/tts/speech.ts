import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { UserError } from "../player/errors.js";
import { MAX_ANNOUNCEMENT_LENGTH } from "../shared/announcements.js";
import { spellForSpeech } from "./spelling.js";
import { PIPER_DIR, voiceModelPath, voiceToUse } from "./voices.js";

/**
 * Turns text into speech with Piper (offline text-to-speech, downloaded by `npm run setup:piper`). Piper writes a WAV
 * file, which Lavalink then plays like a library file, so speech goes through the one voice path like everything else.
 */

const PROJECT_ROOT = resolve(import.meta.dirname, "../..");
const PIPER_EXE = join(PIPER_DIR, "piper.exe");

/** Where speech files wait while they play. Each is deleted once it has played; the folder is emptied on every start. */
const SPEECH_DIR = join(PROJECT_ROOT, "data", "tts");

/**
 * Checks and tidies what someone wants announced: line breaks and repeated spaces become single spaces (Piper reads
 * each line as a separate sentence, and the length limit shouldn't count spaces nobody hears).
 */
export function cleanAnnouncementText(text: string): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (cleaned === "") throw new UserError("Type what the bot should say.");
  if (cleaned.length > MAX_ANNOUNCEMENT_LENGTH) {
    throw new UserError(`An announcement can be at most ${MAX_ANNOUNCEMENT_LENGTH} characters (this one is ${cleaned.length}).`);
  }
  return cleaned;
}

/** How to speak: the server's voice (null = the default) and speed (1 = the voice's normal speed). */
export interface SpeechOptions {
  voiceId: string | null;
  speed: number;
}

/** Speaks `text` into a new WAV file and returns its path. The caller deletes it when done (`deleteSpeechFile`). */
export async function synthesizeSpeech(text: string, { voiceId, speed }: SpeechOptions): Promise<string> {
  if (!existsSync(PIPER_EXE)) {
    throw new UserError("Text-to-speech isn't set up on the bot's computer. Run `npm run setup:piper` there.");
  }
  // The server's voice, or the default one if it was deleted.
  const voice = voiceToUse(voiceId);

  await mkdir(SPEECH_DIR, { recursive: true });
  const outputPath = join(SPEECH_DIR, `${randomUUID()}.wav`);
  const args = [
    "--model",
    voiceModelPath(voice.id),
    "--output_file",
    outputPath,
    // Piper's speed setting is how long each sound lasts: 0.5 is twice as fast, 2 half as fast.
    "--length_scale",
    String(1 / speed),
  ];
  // The voices can't read Japanese, Chinese, Cyrillic and so on; spell them in Latin letters first.
  await runPiper(args, await spellForSpeech(text));
  return outputPath;
}

export async function deleteSpeechFile(path: string): Promise<void> {
  await rm(path, { force: true });
}

/** Deletes speech files left over from before a restart or crash. Called on startup. */
export async function clearSpeechFiles(): Promise<void> {
  await rm(SPEECH_DIR, { recursive: true, force: true });
}

/** Runs Piper with `text` as its input. Piper reads the text from stdin, so nothing typed ends up on a command line. */
function runPiper(args: string[], text: string): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    // cwd: Piper finds its espeak-ng-data folder (pronunciation rules) next to where it runs.
    const child = execFile(PIPER_EXE, args, { cwd: PIPER_DIR, timeout: 30_000 }, (error, _stdout, stderr) => {
      if (!error) return resolvePromise();
      // Details are for the console; the user only needs to know it didn't work.
      console.warn(`[tts] Piper failed: ${stderr.trim().split("\n").at(-1) ?? error.message}`);
      reject(new UserError("The bot couldn't turn that text into speech. Details are in the bot's console."));
    });
    child.stdin?.end(text, "utf8");
  });
}
