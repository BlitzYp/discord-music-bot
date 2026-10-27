// Downloads Piper (offline text-to-speech, used for /announce) into bin/piper/, plus one voice into bin/piper/voices/.
// Usage: npm run setup:piper [-- <voice>]   e.g. npm run setup:piper -- en_GB-alan-medium
// More voices are easier to get on the website's Admin page; the bot only uses voices listed in src/shared/voices.ts.
import { execFileSync } from "node:child_process";
import { createWriteStream, existsSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

// The last release with a ready-made Windows program. Newer Piper versions only come as a Python package.
const PIPER_VERSION = "2023.11.14-2";
const DEFAULT_VOICE = "en_US-lessac-medium";

if (process.platform !== "win32") throw new Error("This script only downloads Piper for Windows.");

const binDir = new URL("../bin/", import.meta.url);
const piperExe = new URL("piper/piper.exe", binDir);
const voice = process.argv[2] ?? DEFAULT_VOICE;

await mkdir(binDir, { recursive: true });

if (existsSync(piperExe) && !process.argv.includes("--force")) {
  console.log("bin/piper/piper.exe already exists (pass --force to re-download).");
} else {
  const zip = new URL("piper.zip", binDir);
  await download(`https://github.com/rhasspy/piper/releases/download/${PIPER_VERSION}/piper_windows_amd64.zip`, zip, "Piper");
  // The zip holds a "piper" folder. Windows 10 and newer come with a tar that also unpacks zip files. Its full path,
  // because Git for Windows puts its own tar (which can't read zip files or C:\ paths) first on the PATH.
  const windowsTar = `${process.env.SystemRoot ?? "C:\\Windows"}\\System32\\tar.exe`;
  execFileSync(windowsTar, ["-xf", fileURLToPath(zip), "-C", fileURLToPath(binDir)], { stdio: "inherit" });
  await rm(zip);
  console.log("Saved bin/piper/");
}

// A voice is a model (.onnx) and its settings (.onnx.json). Its name says where it lives: en_US-lessac-medium is
// en/en_US/lessac/medium/ in the voice collection.
const match = voice.match(/^(([a-z]+)_[A-Z]+)-(\w+)-(\w+)$/);
if (!match) throw new Error(`"${voice}" isn't a voice name like en_US-lessac-medium.`);
const [, locale, language, speaker, quality] = match;
const voicesDir = new URL("piper/voices/", binDir);
await mkdir(voicesDir, { recursive: true });
const base = `https://huggingface.co/rhasspy/piper-voices/resolve/main/${language}/${locale}/${speaker}/${quality}/${voice}`;
for (const extension of [".onnx", ".onnx.json"]) {
  const dest = new URL(voice + extension, voicesDir);
  if (existsSync(dest) && !process.argv.includes("--force")) continue;
  await download(base + extension, dest, voice + extension);
}
console.log(`Voice ${voice} is in bin/piper/voices/`);

async function download(url, dest, label) {
  console.log(`Downloading ${label}...`);
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`Download failed: HTTP ${res.status} (${url})`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
}
