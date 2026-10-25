// Downloads the latest yt-dlp into bin/. The bot uses this copy if it exists, and updates it on every start.
import { chmod, mkdir } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const asset = { win32: "yt-dlp.exe", darwin: "yt-dlp_macos", linux: "yt-dlp_linux" }[process.platform];
if (!asset) throw new Error(`No yt-dlp download for platform ${process.platform}`);

const url = `https://github.com/yt-dlp/yt-dlp/releases/latest/download/${asset}`;
const dest = new URL(`../bin/${process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp"}`, import.meta.url);

await mkdir(new URL("../bin/", import.meta.url), { recursive: true });
console.log(`Downloading ${asset}...`);
const res = await fetch(url);
if (!res.ok || !res.body) throw new Error(`Download failed: HTTP ${res.status}`);
await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
if (process.platform !== "win32") await chmod(dest, 0o755);
console.log(`Saved ${dest.pathname}`);
