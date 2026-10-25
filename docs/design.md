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
| Auth | Discord OAuth2 login (`identify` only), session in a signed cookie |
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

`src/playlists/` (milestone 7) holds `PlaylistManager`. Planned folders that don't exist yet: `src/library/` (upload pipeline, ffprobe/ffmpeg helpers) and `src/player/resolvers/file.ts`. `data/` (gitignored) holds the SQLite database `bot.db`, the yt-dlp cache and, from milestone 8, `library/`. Startup order in `src/index.ts`: config → db → Lavalink → bot → web.

## Playback

### Why Lavalink is the only voice path
A bot gets one voice connection per server. Lavalink owns that connection (the bot forwards voice state/server updates to it through the client library). Mixing in `@discordjs/voice` would force a disconnect and reconnect whenever the queue switched sources. So every track ends up as something Lavalink can load: a Lavalink identifier, a direct HTTP URL, or a local file path.

### Track model
`TrackSource` and `QueueItem` live in [src/shared/types.ts](../src/shared/types.ts). The queue stores the **original input**. Display metadata (title, duration) is fetched when an item is added, but the item is resolved into a playable Lavalink track **only right before it plays**, because yt-dlp URLs and Discord CDN URLs expire.

### YouTube resolution modes (built in milestone 3; the owner's global setting since milestone 6)
- `lavalink`: load the link through the `youtube-source` Lavalink plugin.
- `ytdlp`: `yt-dlp -f "bestaudio[acodec=opus]/bestaudio" --no-playlist` downloads the audio to `data/ytdlp-cache/`, and Lavalink plays the file through its local source.
- `auto` (default): try the plugin; if loading fails or the track errors, retry once with yt-dlp, from the position where playback stopped.
- Links from other sites always use Lavalink first and yt-dlp as the backup. This is what makes SoundCloud work, since it's broken in Lavalink 4.2.2.

Notes:
- The original plan was to hand Lavalink the direct audio URL from `yt-dlp -g`. Tested 2026-10-25, YouTube answers those URLs with 403 unless the request comes from yt-dlp itself, so downloading became the method. A download takes about 10 seconds (around 5 of which is yt-dlp reading the page); the metadata lookup's JSON is reused through `--load-info-json` to skip that step when possible.
- Downloaded files are named by a random id, cached by URL (20 most recent), and deleted on startup. Livestreams can't be downloaded, so they only work through Lavalink.
- yt-dlp needs a JavaScript runtime for YouTube; the bot passes its own Node.js (`--js-runtimes node:<path>`).
- Metadata: `yt-dlp -J --no-playlist <url>`, or Lavalink's `loadTracks`.
- YouTube playlist links (built in milestone 7): `yt-dlp --flat-playlist --playlist-end 500 -J <url>` lists a playlist's videos without downloading them (182 videos in about 4 s). See "Playlists" below.
- yt-dlp lives in `bin/` (`npm run setup:ytdlp`) and is updated with `yt-dlp -U` on every start (unless the owner turns that off), or with "Update now" on the Admin page.
- Possible improvement: in `ytdlp` mode every song pauses ~10 s before starting; downloading the next queued song while the current one plays would remove the pause.
- YouTube breaks downloaders regularly; that is why `auto` mode exists. The fix is usually updating yt-dlp and the YouTube plugin version in `lavalink/application.yml`.
- Downloading from YouTube breaks its terms of service. That's acceptable for private use, so the bot stays private (no public bot listings).

### Local audio files (milestone 8)
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

## Auth & permissions (built in milestone 5)

- OAuth2 scope: `identify` only. The bot looks up which servers a user is in, and their roles there, itself (see below), so the website never needs to keep a Discord token.
- Sessions live in a signed cookie (`cookie-session`, signed with `SESSION_SECRET`) holding just the user's id, name and avatar: `httpOnly`, `sameSite=lax`, and `secure` once `PUBLIC_URL` is https. Logins survive bot restarts and no session table is needed. (The original plan was `express-session` with a SQLite store; the cookie is simpler and needs no database.)
- Add the OAuth2 redirect `<PUBLIC_URL>/api/auth/callback` in the Developer Portal under OAuth2 → Redirects.
- The dashboard lists servers where the user is a member **and** the bot is present, found by looking the user up in each of the bot's servers.
- Changes must be sent as JSON; the server refuses anything else (415). Together with `sameSite=lax` this stops other websites from making changes through a logged-in browser.
- The DJ rule (`isDj()` in `src/permissions.ts`): the server's DJ role if one is set, otherwise admins only. Picking the @everyone role (its id is the server's id) makes every member a DJ.
- Permission levels:
  - **Bot owner** (`OWNER_ID` env): global settings, every server.
  - **Server admin** (Administrator or Manage Server in that server): that server's settings and all controls.
  - **DJ** (has the configured DJ role): playback controls; uploads if the server allows them.
  - **Member:** read-only view of the queue and the current track.
- Check permissions **on the server for every change**, for both web routes and slash commands. Look up roles with `guild.members.fetch(userId)` (a REST call that needs no privileged intent), cached for about 30 s. Treat everything the client sends as untrusted.
- **Joining voice:** the bot joins the voice channel the requester is in (taken from the voice-state cache). From the website, the user must be in a voice channel on that server, otherwise reply "join a voice channel first".
- Gateway intents: `Guilds`, `GuildVoiceStates` only (no privileged intents).

## Configuration (built in milestone 6)

The types, defaults and allowed ranges live in [src/shared/settings.ts](../src/shared/settings.ts). `SettingsStore` reads them from SQLite on every use, so a change applies to the next command.

**Global (bot owner, Admin page):**
- `youtubeMode`: `auto` | `lavalink` | `ytdlp`
- `ytdlpAutoUpdate`: on/off, plus an "Update now" button
- Status view: bot uptime and servers; Lavalink connection, version, YouTube plugin version, players and memory; yt-dlp version
- Milestone 8 adds `maxUploadMb` and `guildQuotaMb` (left out until uploads exist, so the page has no settings that do nothing).

**Per server (server admins, Settings tab):**
- `djRoleId` (unset = only admins can control playback; @everyone = every member)
- `defaultVolume`: the volume the bot joins at
- `maxQueueLength`, `maxTrackDurationSec` (optional; livestreams are exempt from the length limit)
- `requireSameVoiceChannel`: while the bot is in a voice channel, DJs must be in it to control playback (default off; admins are exempt)
- `leaveWhenEmptyAfterSec` (default 60; 0 = never leave)
- `announceChannelId` (optional "Now playing" messages; a song repeating or retried with yt-dlp isn't announced again)
- Milestone 8 adds `uploadPermission`: `dj` | `admin` | `off`.

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

## Data (SQLite, built in milestone 6)
`data/bot.db`, opened with `better-sqlite3` in WAL mode. The tables are created by numbered migrations in [src/db/migrations.ts](../src/db/migrations.ts); SQLite's `user_version` counts how many have run.
- `global_settings(key PRIMARY KEY, value)`: the value is JSON
- `guild_settings(guild_id PRIMARY KEY, dj_role_id, default_volume, max_queue_length, max_track_duration_sec, require_same_vc, leave_after_sec, announce_channel_id)`: no row = the defaults
- `player_state(guild_id PRIMARY KEY, voice_channel_id, text_channel_id, current_item_json, position_ms, paused, volume, loop_mode, filter, updated_at)`
- `queue_items(guild_id, position, item_json)`: one row per `QueueItem`; position 1 plays next
- `history_items(guild_id, position, item_json)`: "Recently played"; position 1 is the newest (20 per server)
- `playlists`, `playlist_items` (migration 2, milestone 7): see "Playlists".
- Milestone 8 adds `library_files(id, guild_id, uploaded_by, original_name, path, mime, duration_ms, size_bytes, created_at)`.

### Queue persistence (built in milestone 6)
- The working copy stays in memory (`Map<guildId, GuildPlayer>`). Every change to the track or the queue rewrites that server's saved state in one transaction; every status change (including Lavalink's once-a-second position update) updates `player_state`. A crash loses about a second.
- On shutdown (Ctrl+C), saving stops before the bot leaves voice, so leaving doesn't save "nothing playing". A killed process needs no shutdown step: everything was already written.
- **On startup:** every saved server is loaded at once, and a track that was playing becomes *interrupted* (the website shows "Stopped by a restart"). Once Discord and a Lavalink session are ready, the bot rejoins the saved voice channel and continues from `position_ms` if people are still in it and the track wasn't paused. Otherwise it waits for `/resume` or `/play`, which join the requester's channel and continue it.
- Restored items are re-resolved when they play, as usual, so expired URLs don't matter.
- Nice to have: `lavalink-client` session resuming, so a restart of just the bot process doesn't interrupt audio at all while Lavalink keeps running.

## Playlists (built in milestone 7)

Saved, per-server playlists, an idea from the owner. They need storage, so they come after the database (milestone 6).

**What people can do:**
- **Everyone in the server** can browse the server's playlists and add songs to them (on the website, or with `/playlist add`).
- **DJs** create, rename and delete playlists, and remove songs from them. Members can also remove songs they added themselves.
- **Playing a playlist (DJ):** "Play" **replaces** the current queue: the current track stops, the queue is cleared, and the playlist's songs are queued in order. The website asks for confirmation first if the queue isn't empty. "Add to queue" appends instead.
- **Importing a YouTube playlist (DJ):** paste a YouTube playlist link to create a playlist from it (or add its videos to an existing one). `yt-dlp --flat-playlist -J <url>` lists the videos' links, titles and durations in a second or two, without downloading anything. Like everything else, the songs are stored as links and loaded when they play. Cap imports at around 500 songs.
- **Save the queue as a playlist (DJ):** turns the current track plus the queue into a new playlist.
- **Pasting a playlist link into "Add a song" or `/play`:** by default only the selected video is queued. A checkbox on the website (`wholePlaylist: true` on `POST /queue`) and `/play playlist: True` queue every song instead, using the same import.
- Limits: names up to 50 characters, unique per server ignoring upper/lower case; at most 500 songs per playlist. When a playlist plays, the server's queue limit and longest-song setting apply; songs left out are counted in the reply.
- Rename and reorder are on the website only; Discord has `/playlist remove` for removing by position.
- Only playing a playlist follows `requireSameVoiceChannel`; editing playlists isn't controlling playback.
- Spotify playlists would need the LavaSrc plugin and Spotify API keys; out of scope.

**Slash commands:** `/playlist list`, `/playlist show <name>`, `/playlist play <name> [mode]`, `/playlist add <name> <link>`, `/playlist remove <name> <position>`, `/playlist create <name>`, `/playlist import <name> <youtube-playlist-link>` (creates the playlist if it doesn't exist), `/playlist save <name>` (the queue), `/playlist delete <name>`. Names are suggested while typing.

**Data:**
- `playlists(id, guild_id, name COLLATE NOCASE, created_by_id, created_by_name, created_at)`; `UNIQUE (guild_id, name)`.
- `playlist_items(id, playlist_id, position, source_json, title, author, duration_ms, is_stream, thumbnail, added_by_id, added_by_name, added_at)`; positions are 1, 2, 3… without gaps.
- The name is stored next to each id, so pages show who made or added something without asking Discord.

**Live updates:** every change emits `playlists:update` (no data) to the server's Socket.IO room; open pages reload the list.

**REST API:**
```
GET    /guilds/:id/playlists                          (member) names, song counts, total length
GET    /guilds/:id/playlists/:playlistId              (member) the songs
POST   /guilds/:id/playlists                          (dj) { name } | { name, importUrl }
PATCH  /guilds/:id/playlists/:playlistId              (dj) { name }
DELETE /guilds/:id/playlists/:playlistId              (dj)
POST   /guilds/:id/playlists/:playlistId/items        (member) { input } | (dj) { importUrl }
DELETE /guilds/:id/playlists/:playlistId/items/:item  (dj, or whoever added it)
PATCH  /guilds/:id/playlists/:playlistId/items/:item  (dj) { position }
POST   /guilds/:id/playlists/:playlistId/play         (dj) { mode: "replace" | "append" }
POST   /guilds/:id/playlists/from-queue               (dj) { name }
```

## Real-time (Socket.IO, built in milestone 4)
- The client sends `guild:watch <id>` and joins the room `guild:<id>`. From milestone 5, the server first checks that the logged-in user is a member of that server.
- Server → client: `state` (full snapshot on join), `queue:update`, `track:start`, `track:end`, `player:update` (position, paused, volume, loop mode, filter; about once per second while playing), `error`, `playlists:update` (milestone 7). The types live in `src/shared/types.ts`.
- **Changes go over REST; sockets only push updates.** This keeps authorization and validation in one place.
- The website shows when Lavalink is down. `lavalink-client` reconnects by itself, but playback fails until it does.

## Interfaces

### Website layout

The Player tab puts the current song in a full-width section at the top: artwork and title, then progress and playback controls. Audio effects expand below the controls, with the active effect shown in the summary. Adding a song belongs with the queue: the form sits under **Up next**, outside a height-limited, keyboard-scrollable song list. **Recently played** sits beside the queue on wide screens and follows it on smaller screens, with a **+** action to queue a song again. Neutral surfaces, text-style secondary actions, list dividers and underlined navigation follow the system's light/dark theme. Artwork has a consistent fallback when an image is unavailable. On phones, row actions wrap below song details; move buttons remain available where dragging is unsupported. This layout uses the existing API and permission checks.

### Slash commands
`/play <query|url> [playlist]` · `/play file:<attachment>` · `/playlist …` (see "Playlists") · `/skip` · `/stop` · `/pause` · `/resume` · `/queue` · `/nowplaying` · `/remove <pos>` · `/move <from> <to>` · `/shuffle` · `/loop off|track|queue` · `/volume <0-150>` · `/filter <effect>` · `/seek <time>` · `/library` · `/dashboard` (link to the website)

`/filter` (added alongside milestone 3, at the owner's request) uses Lavalink's built-in filters: nightcore, vaporwave, bassboost, 8d, karaoke, soft, or off. One effect at a time, kept on the player until changed. The website offers the same list (`AUDIO_FILTERS` in `src/shared/filters.ts`) through `POST /guilds/:id/player/filter { filter }`, which needs DJ permission from milestone 5.

### REST API (under `/api`, login required unless noted)
Built in milestone 5 (member = any member of that server, dj = may control playback):
```
GET    /auth/login                 (no login) → Discord's consent page
GET    /auth/callback              (no login) ← Discord sends the user back here
POST   /auth/logout
GET    /me
GET    /guilds                     servers the user shares with the bot, with their level
GET    /guilds/:id/state           (member)
POST   /guilds/:id/queue           (dj) { input: string, wholePlaylist?: true }   ({ fileId } in milestone 8)
DELETE /guilds/:id/queue/:itemId   (dj)
PATCH  /guilds/:id/queue/:itemId   (dj) { position: number }    1 = play next
POST   /guilds/:id/queue/shuffle   (dj)
DELETE /guilds/:id/queue           (dj) empty the queue; the current track keeps playing
DELETE /guilds/:id/history         (dj) empty "Recently played"
POST   /guilds/:id/player/skip | pause | resume | stop   (dj)
POST   /guilds/:id/player/seek     (dj) { positionMs }
POST   /guilds/:id/player/volume   (dj) { volume }
POST   /guilds/:id/player/loop     (dj) { mode }
POST   /guilds/:id/player/filter   (dj) { filter }
```
Built in milestone 6 (`GET /me` also gained `isOwner`, and DJ routes enforce `requireSameVoiceChannel`):
```
GET    /guilds/:id/settings        (admin) the settings, plus the roles and text channels to pick from
PATCH  /guilds/:id/settings        (admin) any subset of the settings, checked with zod
GET    /admin/settings             (owner)
PATCH  /admin/settings             (owner)
GET    /admin/status               (owner)
POST   /admin/ytdlp/update         (owner) update yt-dlp now
```
Built in milestone 7: the playlist routes listed under "Playlists".

Planned:
```
GET    /guilds/:id/library
POST   /guilds/:id/library         (multipart upload)
DELETE /guilds/:id/library/:fileId
```
