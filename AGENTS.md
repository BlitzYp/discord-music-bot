# Discord Music Bot

A self-hosted Discord bot that plays audio in voice channels, controlled by slash commands and (later) a web dashboard. TypeScript + discord.js v14; audio is played by Lavalink v4, a separate Java server on the same machine. Runs on the owner's Windows PC for their own and friends' servers.

**Status:** milestone 1 works: the owner played YouTube through `/play` in Discord on 2026-10-25. Milestone 2 is written and its queue logic passes a fake-Lavalink test, but it hasn't been tested in Discord yet. YouTube playback needs the unreleased plugin build pinned in `lavalink/application.yml` (its comments explain why). Milestone 3 is written and tested against the owner's Lavalink (yt-dlp downloads, the SoundCloud fallback, retrying a failed track with yt-dlp), but not yet in Discord.

## Where to look

- **[docs/design.md](docs/design.md)**: the full design. Read the relevant section before starting a milestone, and before touching playback sources (yt-dlp, uploads), permissions, settings, the database, or the web API and sockets.
- **[docs/how-it-works.md](docs/how-it-works.md)**: how the current code runs. Read it before changing `src/player/` or adding a slash command. It covers why `GuildPlayer` keeps its own queue, the `queueEnd` event, `run()` and `UserError`.
- **[README.md](README.md)**: the owner's setup, running and troubleshooting guide.

## Milestones

Build them in order. Each milestone works end to end in Discord before the next one starts.

1. **Skeleton:** config, Lavalink running, bot online; `/play <url>` through the Lavalink YouTube plugin; `/skip`, `/stop`, `/queue`. *(working)*
2. **Player features:** pause/resume, remove/move, loop, shuffle, volume, leave automatically when the channel is empty. *(written)*
3. **YouTube resolver modes:** yt-dlp resolver and `auto` fallback (mode hardcoded for now). *(written)*
4. **Read-only web view:** Express + Socket.IO + React page showing the current track and the queue live (localhost, no auth yet).
5. **Auth + web controls:** Discord OAuth, server list, permission checks, adding links, skip, reorder and remove from the website.
6. **Settings + persistence:** SQLite, per-server settings page, owner admin panel (YouTube mode, limits, status), queues restored after restart.
7. **Library:** `/play file:`, website uploads, ffprobe/ffmpeg pipeline, library browser.
8. **Polish:** text search, playlists, progress bar and seeking, Cloudflare Tunnel, run as a background service (pm2 or NSSM).

## Architecture rules

- **Thin wrappers:** slash commands (and later web routes) only parse input, call a `PlayerManager` method and format the reply. Playback logic lives in `PlayerManager`/`GuildPlayer`, so Discord and the website always share one state.
- **Resolve at play time:** the queue stores the user's original input; it becomes a playable track only right before it plays, because yt-dlp and Discord CDN URLs expire.
- **Lavalink is the only voice path.** Every source ends up as something Lavalink loads: a link, a direct HTTP URL or a local file path. `@discordjs/voice` stays out of the project.
- **Server-side permissions:** from milestone 5, every change is permission-checked on the server, on both the slash-command and the web path.
- **Secrets live in `.env` only**, validated in `src/config.ts`; new variables also go into `.env.example`.
- Types shared by the backend and the future frontend go in `src/shared/`.

## Working style

- **Readable code is a requirement:** the owner wants to read and extend this code without help. Use clear names, small functions and explicit code over clever one-liners. Label boolean arguments. Comment the *why* of anything non-obvious (library quirks, event order, concurrency).
- **Docs move with the code:** a change that adds or alters behaviour updates `README.md` (setup, commands, troubleshooting) and `docs/how-it-works.md` (code flow, extension guides) in the same change; design changes update `docs/design.md`.
- The owner's machine is Windows; run commands natively there.
- A change is done when `npm run typecheck` passes and the behaviour has been checked as far as possible without the owner. Lavalink needs no Discord token: start it with `npm run lavalink`, then load links through `lavalink-client` to test resolvers. To test YouTube *playback*, the plugin's `GET /youtube/stream/<videoId>?withClient=<CLIENT>` endpoint streams real audio (send the Lavalink password as the `Authorization` header); run a second Lavalink on another port to compare configs without stopping the owner's. Playback in a voice channel is the owner's check in Discord; say what's left for them to test.
