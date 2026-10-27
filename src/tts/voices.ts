import { createWriteStream, existsSync } from "node:fs";
import { mkdir, rename, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream } from "node:stream/web";
import { UserError } from "../player/errors.js";
import {
  DEFAULT_VOICE_ID,
  findVoice,
  type Voice,
  type VoiceLanguage,
  VOICES,
  type VoiceStatus,
} from "../shared/voices.js";

/**
 * The voices on this PC: bin/piper/voices/<id>.onnx (the voice itself) and <id>.onnx.json (its settings). The bot owner
 * downloads and deletes them on the Admin page; `npm run setup:piper` downloads the default one.
 */

const PROJECT_ROOT = resolve(import.meta.dirname, "../..");
export const PIPER_DIR = join(PROJECT_ROOT, "bin", "piper");
const VOICES_DIR = join(PIPER_DIR, "voices");

/** What a voice says when an admin presses Listen on the Settings page, in its own language. */
export const SAMPLE_SENTENCES: Record<VoiceLanguage, string> = {
  en: "Hi, I'm Brick Maback. This is how my announcements sound.",
  de: "Hallo, ich bin Brick Maback. So klingen meine Ansagen.",
  lv: "Sveiki, es esmu Brick Maback. Tā skan mani paziņojumi.",
};

/** Voices being downloaded right now, so a second click doesn't start a second download. */
const downloading = new Map<string, Promise<void>>();

/** Where a voice's model file is. */
export function voiceModelPath(voiceId: string): string {
  return join(VOICES_DIR, `${voiceId}.onnx`);
}

export function isVoiceDownloaded(voiceId: string): boolean {
  return existsSync(voiceModelPath(voiceId)) && existsSync(`${voiceModelPath(voiceId)}.json`);
}

/** Every voice on offer, and whether it's downloaded. */
export function voiceStatuses(): VoiceStatus[] {
  return VOICES.map((voice) => ({ ...voice, downloaded: isVoiceDownloaded(voice.id), downloading: downloading.has(voice.id) }));
}

/** The voices a server can pick from: the downloaded ones. */
export function downloadedVoices(): Voice[] {
  return VOICES.filter((voice) => isVoiceDownloaded(voice.id));
}

/**
 * The voice to speak with: the server's choice if it's downloaded, otherwise the default voice, otherwise any
 * downloaded voice. Throws when there's none at all.
 */
export function voiceToUse(chosenId: string | null): Voice {
  for (const id of [chosenId, DEFAULT_VOICE_ID]) {
    const voice = id ? findVoice(id) : undefined;
    if (voice && isVoiceDownloaded(voice.id)) return voice;
  }
  const any = downloadedVoices()[0];
  if (any) return any;
  throw new UserError("Text-to-speech isn't set up on the bot's computer. Run `npm run setup:piper` there.");
}

/**
 * Downloads a voice from Piper's collection on Hugging Face (about 60 MB; 5–30 seconds). Each file is saved under a
 * temporary name and renamed when complete, so a broken download never looks like a downloaded voice.
 */
export async function downloadVoice(voiceId: string): Promise<void> {
  const voice = requireVoice(voiceId);
  if (isVoiceDownloaded(voice.id)) return;

  let download = downloading.get(voice.id);
  if (!download) {
    download = downloadFiles(voice.id).finally(() => downloading.delete(voice.id));
    downloading.set(voice.id, download);
  }
  await download;
}

/** Deletes a downloaded voice. Servers that picked it speak with the default voice instead. */
export async function deleteVoice(voiceId: string): Promise<void> {
  const voice = requireVoice(voiceId);
  if (voice.id === DEFAULT_VOICE_ID) throw new UserError(`${voice.name} is the default voice, which can't be deleted.`);
  if (downloading.has(voice.id)) throw new UserError(`${voice.name} is still downloading.`);
  await rm(voiceModelPath(voice.id), { force: true });
  await rm(`${voiceModelPath(voice.id)}.json`, { force: true });
}

async function downloadFiles(voiceId: string): Promise<void> {
  await mkdir(VOICES_DIR, { recursive: true });
  console.log(`[tts] downloading the voice ${voiceId}...`);
  for (const extension of [".onnx.json", ".onnx"]) {
    const finalPath = join(VOICES_DIR, voiceId + extension);
    const partPath = `${finalPath}.part`;
    try {
      const response = await fetch(voiceUrl(voiceId) + extension);
      if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);
      await pipeline(Readable.fromWeb(response.body as ReadableStream), createWriteStream(partPath));
      await rename(partPath, finalPath);
    } catch (error) {
      await rm(partPath, { force: true });
      console.warn(`[tts] downloading ${voiceId}${extension} failed: ${error instanceof Error ? error.message : error}`);
      throw new UserError("The voice couldn't be downloaded. Details are in the bot's console.");
    }
  }
  console.log(`[tts] downloaded the voice ${voiceId}`);
}

/**
 * Where Piper's collection keeps a voice, without the file extension. The name says where: en_US-lessac-medium is
 * en/en_US/lessac/medium/en_US-lessac-medium.
 */
function voiceUrl(voiceId: string): string {
  const [locale, speaker, quality] = voiceId.split("-") as [string, string, string];
  const language = locale.split("_")[0];
  return `https://huggingface.co/rhasspy/piper-voices/resolve/main/${language}/${locale}/${speaker}/${quality}/${voiceId}`;
}

function requireVoice(voiceId: string): Voice {
  const voice = findVoice(voiceId);
  if (!voice) throw new UserError("There's no voice with that name.");
  return voice;
}
