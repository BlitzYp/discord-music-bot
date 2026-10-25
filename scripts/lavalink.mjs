// Starts Lavalink with the password and port from .env, so the secret never lives in application.yml.
import "dotenv/config";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const cwd = fileURLToPath(new URL("../lavalink/", import.meta.url));
if (!existsSync(new URL("../lavalink/Lavalink.jar", import.meta.url))) {
  console.error("lavalink/Lavalink.jar is missing. Run: npm run setup:lavalink");
  process.exit(1);
}
if (!process.env.LAVALINK_PASSWORD) {
  console.error("LAVALINK_PASSWORD is not set in .env");
  process.exit(1);
}

const child = spawn("java", ["-jar", "Lavalink.jar"], {
  cwd,
  stdio: "inherit",
  env: {
    ...process.env,
    LAVALINK_SERVER_PASSWORD: process.env.LAVALINK_PASSWORD,
    SERVER_PORT: process.env.LAVALINK_PORT ?? "2333",
  },
});
child.on("exit", (code) => process.exit(code ?? 0));
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => child.kill(sig));
