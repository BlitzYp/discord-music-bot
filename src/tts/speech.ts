import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { UserError } from "../player/errors.js";
import { MAX_ANNOUNCEMENT_LENGTH } from "../shared/announcements.js";

/**
 * Turns text into speech with Piper (offline text-to-speech, downloaded by `npm run setup:piper`). Piper writes a WAV
 * file, which Lavalink then plays like a library file, so speech goes through the one voice path like everything else.
 */

const PROJECT_ROOT = resolve(import.meta.dirname, "../..");
const PIPER_DIR = join(PROJECT_ROOT, "bin", "piper");
const PIPER_EXE = join(PIPER_DIR, "piper.exe");
/** The voice every announcement uses for now. Others can be downloaded with `npm run setup:piper -- <voice>`. */
const VOICE = "en_US-lessac-medium";

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

/** Speaks `text` into a new WAV file and returns its path. The caller deletes it when done (`deleteSpeechFile`). */
export async function synthesizeSpeech(text: string): Promise<string> {
  const model = join(PIPER_DIR, "voices", `${VOICE}.onnx`);
  if (!existsSync(PIPER_EXE) || !existsSync(model)) {
    throw new UserError("Text-to-speech isn't set up on the bot's computer. Run `npm run setup:piper` there.");
  }

  await mkdir(SPEECH_DIR, { recursive: true });
  const outputPath = join(SPEECH_DIR, `${randomUUID()}.wav`);
  await runPiper(["--model", model, "--output_file", outputPath], text);
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
