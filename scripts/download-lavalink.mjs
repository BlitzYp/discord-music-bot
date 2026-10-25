// Downloads Lavalink.jar into lavalink/. The YouTube plugin is fetched by Lavalink itself on first start.
import { createWriteStream, existsSync } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const VERSION = process.argv[2] ?? "4.2.2";
const url = `https://github.com/lavalink-devs/Lavalink/releases/download/${VERSION}/Lavalink.jar`;
const dest = new URL("../lavalink/Lavalink.jar", import.meta.url);

if (existsSync(dest) && !process.argv.includes("--force")) {
  console.log("lavalink/Lavalink.jar already exists (pass --force to re-download).");
  process.exit(0);
}

console.log(`Downloading Lavalink ${VERSION}...`);
const res = await fetch(url);
if (!res.ok || !res.body) throw new Error(`Download failed: HTTP ${res.status}`);
await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
console.log("Saved lavalink/Lavalink.jar");
