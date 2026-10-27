# Discord Music Bot

A self-hosted Discord bot that plays audio in voice channels, controlled by slash commands and a web dashboard. TypeScript + discord.js v14; audio is played by Lavalink v4, a separate Java server on the same machine. Runs on the owner's Windows PC for their own and friends' servers.

**Status:** see the markers in the milestone list. "working" = the owner confirmed it in Discord or the browser; "written" = built and tested by an agent, not yet by the owner. Things to know:
- YouTube playback needs the unreleased plugin build pinned in `lavalink/application.yml` (its comments explain why).
- With no DJ role picked, only admins control playback; a server admin picks one (or @everyone) on the website's Settings tab.
- The public website is the build (`npm start`); `npm run dev` only serves the page to this PC. The owner logs in to Tailscale and switches Funnel on themselves.
- `npm run dev` restarts on every save in `src/`. Since milestone 6 the queue survives that (the bot rejoins and continues), but warn the owner before editing `src/` while they're listening.
- Extras the owner asked for along the way: `/filter` effects (working, also on the website), seeking (`/seek` and the website's progress bar), a "Recently played" list, the bot's Discord status showing what it's playing, which the owner can override on the Admin page (written), Spotify links, played as YouTube searches (working; see "Spotify links" in docs/design.md), volume normalization, `/normalize` (working; see "Volume normalization" in docs/design.md), `/playnow` and Play next (working), and announcements: `/announce` and the website's Announce box, spoken with Piper (working; see "Announcements" in docs/design.md; automatic announcements are planned next). In Discord the bot is called Brick Maback.

## Where to look

- **[docs/design.md](docs/design.md)**: the full design. Read the relevant section before starting a milestone, and before touching playback sources (yt-dlp, uploads), permissions, settings, the database, or the web API and sockets.
- **[docs/how-it-works.md](docs/how-it-works.md)**: how the current code runs. Read it before changing `src/player/` or adding a slash command. It covers why `GuildPlayer` keeps its own queue, the `queueEnd` event, `run()` and `UserError`.
- **[README.md](README.md)**: the owner's setup, running and troubleshooting guide.

## Milestones

Build them in order. Each milestone works end to end in Discord before the next one starts.

1. **Skeleton:** config, Lavalink running, bot online; `/play <url>` through the Lavalink YouTube plugin; `/skip`, `/stop`, `/queue`. *(working)*
2. **Player features:** pause/resume, remove/move, loop, shuffle, volume, leave automatically when the channel is empty. *(written; the owner has used parts of it)*
3. **YouTube resolver modes:** yt-dlp resolver and `auto` fallback (mode hardcoded for now). *(written)*
4. **Read-only web view:** Express + Socket.IO + React page showing the current track and the queue live (localhost, no auth yet). *(working)*
5. **Auth + web controls:** Discord OAuth, server list, permission checks, and the website's controls: adding links, pause/resume, skip, stop, seek, volume, loop, effects, reorder and remove; plus song history. *(working)*
6. **Settings + persistence:** SQLite, per-server settings page (DJ role!), owner admin panel (YouTube mode, limits, status), queues and history restored after restart. *(written)*
7. **Playlists:** per-server saved playlists that members add to and DJs play (replacing the queue), importing YouTube playlists, saving the queue as a playlist; `/playlist` and the website's Playlists tab. See "Playlists" in docs/design.md. *(working)*
8. **Library:** `/play file:`, website uploads, ffprobe/ffmpeg pipeline, library browser; `/library` and the website's Library tab. See "Local audio files" in docs/design.md. *(working)*
9. **Polish:** text search, a public URL through Tailscale Funnel (`npm run funnel`; the owner picked it over Cloudflare Tunnel). The owner chose to start everything by hand, so there's no background service. See "Text search" and "Public URL" in docs/design.md. *(working)*

## Architecture rules

- **Thin wrappers:** slash commands (and later web routes) only parse input, call a `PlayerManager` method and format the reply. Playback logic lives in `PlayerManager`/`GuildPlayer`, so Discord and the website always share one state.
- **Resolve at play time:** the queue stores the user's original input; it becomes a playable track only right before it plays, because yt-dlp and Discord CDN URLs expire.
- **Lavalink is the only voice path.** Every source ends up as something Lavalink loads: a link, a direct HTTP URL or a local file path. `@discordjs/voice` stays out of the project.
- **Server-side permissions:** every change is permission-checked on the server, on both paths: slash commands declare a `permission` level, and every guild web route starts with `requireGuildAccess()`. Hiding buttons on the website is only for convenience.
- **Secrets live in `.env` only**, validated in `src/config.ts`; new variables also go into `.env.example`.
- Types shared by the backend and the frontend go in `src/shared/`.
- **Schema changes are new migrations:** append to `MIGRATIONS` in `src/db/migrations.ts`; never edit one that already ran.

## Working style

- **Readable code is a requirement:** the owner wants to read and extend this code without help. Use clear names, small functions and explicit code over clever one-liners. Label boolean arguments. Comment the *why* of anything non-obvious (library quirks, event order, concurrency).
- **Docs move with the code:** a change that adds or alters behaviour updates `README.md` (setup, commands, troubleshooting) and `docs/how-it-works.md` (code flow, extension guides) in the same change; design changes update `docs/design.md`.
- The owner's machine is Windows; run commands natively there.
- **Installing packages:** run `npm install --ignore-scripts` (then `npm rebuild esbuild` after a fresh install). Without it npm tries to compile `better-sqlite3` from source, which fails without Visual Studio, even though the package ships a ready-made Windows build.
- A change is done when `npm run typecheck` and `npm test` pass and the behaviour has been checked as far as possible without the owner. Lavalink needs no Discord token: start it with `npm run lavalink`, then load links through `lavalink-client` to test resolvers. To test YouTube *playback*, the plugin's `GET /youtube/stream/<videoId>?withClient=<CLIENT>` endpoint streams real audio (send the Lavalink password as the `Authorization` header); run a second Lavalink on another port to compare configs without stopping the owner's. Playback in a voice channel is the owner's check in Discord; say what's left for them to test.

## Agent skills

### Issue tracker

Issues live in this repo's GitHub Issues (BlitzYp/discord-music-bot), managed with the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

The five default labels: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.
