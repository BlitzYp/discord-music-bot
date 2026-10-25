# Design

The full design of the bot: decisions, how each part should work, and the planned API and database. Parts marked with a milestone aren't built yet; [AGENTS.md](../AGENTS.md) lists the milestones and the current status.

## Decisions

| Area | Decision |
|---|---|
| Language | Node.js + TypeScript |
| Discord library | discord.js v14 |
| Playback engine | **Lavalink v4** (separate Java process). The only thing that joins voice. |
| Lavalink client | `lavalink-client` (alternative: Shoukaku) |
| YouTube | Configurable in the admin panel: Lavalink YouTube plugin, yt-dlp, or `auto` (plugin first, yt-dlp fallback) |
| Other sources | Lavalink natively (SoundCloud, Bandcamp, Twitch, direct HTTP URLs) |
| Local audio files | Discord attachments + website uploads, saved to a per-server library, played by Lavalink |
| ffmpeg | Only `ffprobe` validation + transcoding unsupported uploads. Not in the playback path. |
| Web backend | Express + Socket.IO, in the same process as the bot |
| Web frontend | React + Vite SPA, served by Express in production |
| Auth | Discord OAuth2 login |
| Permissions | Per-server DJ role (configurable); server admins bypass; bot owner controls global settings |
| No DJ role set | Admins only until a server admin picks a DJ role |
| Voice-channel requirement | Not required to control playback (`requireSameVoiceChannel` defaults to off) |
| Queue persistence | Queues and player state are saved to SQLite and restored after a restart |
| Storage | SQLite (`better-sqlite3`) |
| Hosting | Owner's home machine (Windows); Cloudflare Tunnel for a public HTTPS URL |

## Architecture

```
Discord users ── slash commands ──┐
                                  ▼
Browser ── HTTPS (CF Tunnel) ──▶ Node process (TypeScript)
        ◀─ Socket.IO updates ──   ├─ discord.js bot
                                  ├─ Express API + Socket.IO
                                  ├─ PlayerManager (one GuildPlayer per server)
                                  ├─ resolvers (Lavalink / yt-dlp / library file)
                                  └─ SQLite (settings, library, sessions)
                                        │ REST + WebSocket
                                        ▼
                                  Lavalink (Java) ── voice ──▶ Discord voice channel
```

Slash commands and web routes are thin wrappers over the same `PlayerManager` methods. Every state change emits an event that the web layer forwards to that server's Socket.IO room. Neither UI keeps its own copy of the state, so Discord and the website always agree.

Planned folders that don't exist yet: `src/db/` (connection, migrations, repositories), `src/library/` (upload pipeline, ffprobe/ffmpeg helpers), `src/web/` (Express app, auth, `routes/`, `socket.ts`, `permissions.ts`), `src/player/resolvers/ytdlp.ts` and `file.ts`, `web/` (React + Vite frontend), and `data/` (SQLite DB and `library/`, gitignored). Startup order in `src/index.ts`: config → db → Lavalink → bot → web.

## Playback

### Why Lavalink is the only voice path
A bot gets one voice connection per server. Lavalink owns that connection (the bot forwards voice state/server updates to it through the client library). Mixing in `@discordjs/voice` would force a disconnect and reconnect whenever the queue switched sources. So every track ends up as something Lavalink can load: a Lavalink identifier, a direct HTTP URL, or a local file path.

### Track model
`TrackSource` and `QueueItem` live in [src/shared/types.ts](../src/shared/types.ts). The queue stores the **original input**. Display metadata (title, duration) is fetched when an item is added, but the item is resolved into a playable Lavalink track **only right before it plays**, because yt-dlp URLs and Discord CDN URLs expire.

### YouTube resolution modes (global setting, milestone 3)
- `lavalink`: load the link through the `youtube-source` Lavalink plugin.
- `ytdlp`: `yt-dlp -f "bestaudio[acodec=opus]/bestaudio" -g --no-playlist <url>` returns a direct audio URL, which is handed to Lavalink's HTTP source.
- `auto` (default): try the plugin; if loading fails or the track errors, retry once with yt-dlp.

Notes:
- YouTube locks the URLs yt-dlp returns to the IP address that requested them. This works because yt-dlp and Lavalink run on the same machine. Always resolve and play on the same machine.
- If Lavalink gets HTTP 403 on a yt-dlp URL, fall back to having yt-dlp download to a temp file and play it as a local file.
- Metadata: `yt-dlp -J --no-playlist <url>`, or Lavalink's `loadTracks`.
- Playlists (milestone 8): `yt-dlp --flat-playlist -J <url>` expands a playlist into individual items.
- Keep yt-dlp current (`yt-dlp -U`); consider updating it automatically on startup.
- SoundCloud is broken in Lavalink 4.2.2, so the yt-dlp fallback should cover SoundCloud links too.
- YouTube breaks downloaders regularly; that is why `auto` mode exists. The fix is usually updating yt-dlp and the YouTube plugin version in `lavalink/application.yml`.
- Downloading from YouTube breaks its terms of service. That's acceptable for private use, so the bot stays private (no public bot listings).

### Local audio files (milestone 7)
The fallback for when the big services break: people can play files they already have.
- **From Discord:** `/play file:<attachment>` uses an attachment option on the slash command, so no message-content intent is needed. Download the file into the library straight away, because Discord CDN URLs expire after about 24 hours.
- **From the website:** multipart upload (`multer`), for DJs only.
- **Pipeline:** save to temp → run `ffprobe` to check it is really audio and read the duration and tags → if Lavalink can't decode it, transcode with ffmpeg to Opus/OGG → move to `data/library/<guildId>/<fileId>.<ext>` → insert a DB row.
- **Playback:** through Lavalink's local source (`sources.local: true`; Lavalink must be on the same machine). Alternative: serve the files over an internal Express URL.
- **Formats Lavalink decodes:** MP3, FLAC, WAV, OGG (Opus/Vorbis/FLAC), M4A/MP4 (AAC), WebM/Matroska (Opus/Vorbis).
- **Limits:** maximum file size (global), storage quota per server (global), who can upload (per server).
- Store files under generated IDs; the uploaded file name is display data only, never part of a path.
- The library is per server; it can be browsed, searched and re-queued from the website and with `/library`.
- Free Discord users can upload about 10 MB, so larger files go through the website.

## Auth & permissions (milestone 5)

- OAuth2 scopes: `identify`, `guilds`. Sessions via `express-session` with a SQLite store; cookies set to `httpOnly`, `secure`, `sameSite=lax`.
- Add the OAuth2 redirect `<PUBLIC_URL>/api/auth/callback` in the Developer Portal under OAuth2 → Redirects.
- The dashboard lists servers where the user is a member **and** the bot is present.
- Permission levels:
  - **Bot owner** (`OWNER_ID` env): global settings, every server.
  - **Server admin** (Administrator or Manage Server in that server): that server's settings and all controls.
  - **DJ** (has the configured DJ role): playback controls; uploads if the server allows them.
  - **Member:** read-only view of the queue and the current track.
- Check permissions **on the server for every change**, for both web routes and slash commands. Look up roles with `guild.members.fetch(userId)` (a REST call that needs no privileged intent), cached for about 30 s. Treat everything the client sends as untrusted.
- **Joining voice:** the bot joins the voice channel the requester is in (taken from the voice-state cache). From the website, the user must be in a voice channel on that server, otherwise reply "join a voice channel first".
- Gateway intents: `Guilds`, `GuildVoiceStates` only (no privileged intents).

## Configuration (milestone 6)

**Global (bot owner, admin panel):**
- `youtubeMode`: `auto` | `lavalink` | `ytdlp`
- `maxUploadMb`, `guildQuotaMb`
- yt-dlp auto-update on/off
- Status view: Lavalink node health, yt-dlp version

**Per server (server admins):**
- `djRoleId` (unset = only admins can control playback)
- `defaultVolume`
- `maxQueueLength`, `maxTrackDurationSec` (optional)
- `uploadPermission`: `dj` | `admin` | `off`
- `requireSameVoiceChannel`: whether controlling playback requires being in the bot's voice channel (default off)
- `leaveWhenEmptyAfterSec`
- `announceChannelId` (optional "now playing" messages)

## Keys & secrets

Secrets live in `.env` only: never in the DB, the admin panel or committed files. `src/config.ts` validates them.

| Variable | Where it comes from |
|---|---|
| `DISCORD_TOKEN` | Developer Portal → your app → Bot → Reset Token |
| `DISCORD_CLIENT_ID` | Developer Portal → your app → General Information → Application ID |
| `DISCORD_CLIENT_SECRET` | Developer Portal → your app → OAuth2 → Reset Secret |
| `OAUTH_REDIRECT_URI` | `<PUBLIC_URL>/api/auth/callback`; must also be added under OAuth2 → Redirects |
| `OWNER_ID` | Your own Discord user ID (Developer Mode on → right-click yourself → Copy User ID) |
| `SESSION_SECRET` | A long random string, e.g. `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `LAVALINK_PASSWORD` | Any string. `npm run lavalink` passes it to Lavalink, so `application.yml` holds no secret. |
| `LAVALINK_HOST` / `LAVALINK_PORT` | `localhost` / `2333` |
| `PUBLIC_URL` / `WEB_PORT` | The tunnel URL / the local port Express listens on |
| `DEV_GUILD_ID` | Optional: register slash commands in one server only (instant updates) |

No YouTube, SoundCloud or Bandcamp API keys are needed: Lavalink and yt-dlp work without them.

Possibly needed later:
- **YouTube blocking:** if YouTube starts showing "sign in to confirm you're not a bot", the YouTube plugin can be given OAuth or a poToken, and yt-dlp can be given cookies. Use a throwaway Google account for this, because the account can get flagged.
- **Spotify links:** would need the LavaSrc plugin plus a Spotify client ID and secret from the Spotify developer dashboard. Not in scope for now.
- **Stable public URL:** Cloudflare quick tunnels (`trycloudflare.com`) get a new random URL on every restart, which breaks the OAuth redirect. A named tunnel needs a free Cloudflare account plus a domain on Cloudflare. Tailscale Funnel is a free alternative with a fixed `*.ts.net` URL. Point the tunnel (`cloudflared`) at `WEB_PORT` and use its URL as `PUBLIC_URL`.

## Data (SQLite, milestone 6)
- `global_settings(key PRIMARY KEY, value)`
- `guild_settings(guild_id PRIMARY KEY, dj_role_id, default_volume, max_queue_length, upload_permission, require_same_vc, leave_after_sec, announce_channel_id, ...)`
- `library_files(id, guild_id, uploaded_by, original_name, path, mime, duration_ms, size_bytes, created_at)`
- `sessions` (session store)
- `queue_items(guild_id, position, item_json)`: one row per `QueueItem`
- `player_state(guild_id PRIMARY KEY, voice_channel_id, text_channel_id, current_item_json, position_ms, paused, volume, loop_mode, updated_at)`

### Queue persistence
- The working copy stays in memory (`Map<guildId, GuildPlayer>`). Every queue or player change is also written to SQLite in the same call (`better-sqlite3` is synchronous and fast enough).
- Save `position_ms` on pause, skip and stop, and every few seconds while playing, so a crash loses at most a few seconds.
- **On startup:** load every saved guild. If its saved voice channel still has people in it, rejoin and resume the current track from `position_ms`. Otherwise restore the queue paused and wait for `/resume` or `/play`.
- Restored items are re-resolved when they play, as usual, so expired URLs don't matter.
- Nice to have: `lavalink-client` session resuming, so a restart of just the bot process doesn't interrupt audio at all while Lavalink keeps running.

## Real-time (Socket.IO, milestone 4)
- After the server checks membership, the client joins the room `guild:<id>`.
- Server → client: `state` (full snapshot on join), `queue:update`, `track:start`, `track:end`, `player:update` (position, paused, volume; about once per second while playing), `error`. `PlayerManager` already emits the first four under these names.
- **Changes go over REST; sockets only push updates.** This keeps authorization and validation in one place.
- The website shows when Lavalink is down. `lavalink-client` reconnects by itself, but playback fails until it does.

## Interfaces

### Slash commands
`/play <query|url>` · `/play file:<attachment>` · `/skip` · `/stop` · `/pause` · `/resume` · `/queue` · `/nowplaying` · `/remove <pos>` · `/move <from> <to>` · `/shuffle` · `/loop off|track|queue` · `/volume <0-150>` · `/seek <time>` · `/library` · `/dashboard` (link to the website)

### REST API (under `/api`, session required unless noted)
```
GET    /auth/login                 (no session)
GET    /auth/callback              (no session)
POST   /auth/logout
GET    /me
GET    /guilds
GET    /guilds/:id/state
POST   /guilds/:id/queue           { input: string } | { fileId: string }
DELETE /guilds/:id/queue/:itemId
PATCH  /guilds/:id/queue/:itemId   { position: number }
POST   /guilds/:id/player/skip | pause | resume | stop
POST   /guilds/:id/player/seek     { positionMs }
POST   /guilds/:id/player/volume   { volume }
GET    /guilds/:id/library
POST   /guilds/:id/library         (multipart upload)
DELETE /guilds/:id/library/:fileId
GET    /guilds/:id/settings        (admin)
PATCH  /guilds/:id/settings        (admin)
GET    /admin/settings             (owner)
PATCH  /admin/settings             (owner)
GET    /admin/status               (owner)
```
