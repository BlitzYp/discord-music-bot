// Makes the website public through Tailscale Funnel, for as long as this runs (Ctrl+C turns it off again).
// The bot must be running too, preferably with `npm start` (the development website only works on this computer).
import "dotenv/config";
import { execFileSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";

const port = process.env.WEB_PORT || "3000";
const tailscale = findTailscale();

const status = readStatus();
if (status.BackendState !== "Running") {
  console.error(
    `Tailscale isn't connected (it says "${status.BackendState}"). Open the Tailscale app from the taskbar and log in, ` +
      "or run: tailscale up",
  );
  process.exit(1);
}

// The PC's name in the tailnet, e.g. "my-pc.tail1234.ts.net." (with a dot at the end).
const publicUrl = `https://${status.Self.DNSName.replace(/\.$/, "")}`;
const configuredUrl = (process.env.PUBLIC_URL || "").replace(/\/$/, "");
console.log(`The website will be public at ${publicUrl}`);
if (configuredUrl !== publicUrl) {
  console.warn(
    `\nPUBLIC_URL in .env is "${configuredUrl || "(not set)"}", so logging in through the public URL won't work yet:\n` +
      `  1. In .env, set PUBLIC_URL=${publicUrl}\n` +
      `     and OAUTH_REDIRECT_URI=${publicUrl}/api/auth/callback\n` +
      `  2. In the Discord Developer Portal → your app → OAuth2 → Redirects, add ${publicUrl}/api/auth/callback\n` +
      "     (keep the localhost one, so logging in on this computer keeps working)\n" +
      "  3. Restart the bot.\n",
  );
}
console.log("Press Ctrl+C to make it private again.\n");

// In the foreground, the website is public only while this runs. Tailscale prints a link to switch Funnel on
// for the tailnet the first time, if it isn't yet.
const child = spawn(tailscale, ["funnel", port], { stdio: "inherit" });
child.on("exit", (code) => process.exit(code ?? 0));
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));

/** The tailscale program: on the PATH, or where the Windows installer puts it. */
function findTailscale() {
  const windowsInstall = "C:\\Program Files\\Tailscale\\tailscale.exe";
  if (process.platform === "win32" && existsSync(windowsInstall)) return windowsInstall;
  return "tailscale";
}

function readStatus() {
  try {
    return JSON.parse(execFileSync(tailscale, ["status", "--json"], { encoding: "utf8" }));
  } catch (error) {
    if (error.code === "ENOENT") {
      console.error("Tailscale isn't installed. Get it from https://tailscale.com/download (or: winget install Tailscale.Tailscale)");
    } else {
      console.error(`Couldn't ask Tailscale for its status: ${error.message}`);
    }
    process.exit(1);
  }
}
