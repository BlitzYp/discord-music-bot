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
| Hosting | Owner's home machine (Windows); Tailscale Funnel for a public HTTPS URL; the owner starts everything by hand (no background service) |
| Text search | YouTube Music first, then YouTube (Lavalink's plugin), or yt-dlp; the first result's link is queued |
| Spotify links | Read from Spotify's public embed page (no keys); each song is played as a YouTube search |
| Text-to-speech | Piper, offline, on the owner's PC; the speech is a WAV file Lavalink plays like a library file |

## Architecture

```
Discord users ── slash commands ──┐
                                  ▼
Browser ── HTTPS (Tailscale Funnel) ──▶ Node process (TypeScript)
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

`src/playlists/` (milestone 7) holds `PlaylistManager`; `src/library/` (milestone 8) holds `LibraryManager` and the ffprobe/ffmpeg helpers. Library files are resolved in `src/player/resolvers/index.ts` (no separate `file.ts`: it's a few lines). `data/` (gitignored) holds the SQLite database `bot.db`, the yt-dlp cache and `library/`. Startup order in `src/index.ts`: config → db → Lavalink → bot → web.

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

### Local audio files (built in milestone 8)
The fallback for when the big services break: people can play files they already have.
- **From Discord:** `/play file:<attachment>` (save and play) and `/library upload <attachment>` (save only) use an attachment option on the slash command, so no message-content intent is needed. The file is downloaded into the library straight away, because Discord CDN URLs expire after about 24 hours.
- **From the website:** multipart upload (`multer`), following the server's `uploadPermission`. Uploads aren't JSON, so they must carry the header `X-Requested-With: music-bot` instead, which other websites can't add without a CORS check. The page uploads with `XMLHttpRequest` to show progress, one file at a time.
- **Pipeline:** save to `data/library/.incoming/` → `ffprobe` checks it is really audio and reads the duration and tags → if Lavalink can't decode it (or it has a video stream), ffmpeg converts it to Opus/OGG at 160 kbit/s → move to `data/library/<guildId>/<fileId>.<ext>` → insert a DB row. The incoming folder is emptied on every start.
- **Playback:** through Lavalink's local source (`sources.local: true`; Lavalink must be on the same machine). The queue stores `{ kind: "file", fileId }`; the path is looked up when the item plays.
- **Formats kept as they are:** MP3, FLAC, 16-bit PCM WAV, OGG (Opus/Vorbis/FLAC), M4A (AAC, no video), WebM/Matroska (Opus/Vorbis, no video). Everything else ffmpeg reads is converted. Tested 2026-10-26: AIFF and WMA don't load in Lavalink, and load after converting.
- **Limits:** maximum file size (`maxUploadMb`, global, default 100 MB), storage quota per server (`guildQuotaMb`, global, default 2000 MB), who can upload (`uploadPermission`, per server, default DJs). Deleting needs a DJ; looking is for everyone.
- Files are stored under generated IDs; the uploaded file name is display data only, never part of a path.
- The library is per server; it can be browsed, searched and re-queued from the website and with `/library list|play|upload|delete`.
- Deleting removes the row, then the file. Windows keeps a playing file locked, so that file is deleted on the next start instead (startup deletes files with no row).
- Free Discord users can upload about 10 MB, so larger files go through the website.
- Possible later: renaming a file's title on the website; spotting duplicate uploads.

## Auth & permissions (built in milestone 5)

- OAuth2 scope: `identify` only. The bot looks up which servers a user is in, and their roles there, itself (see below), so the website never needs to keep a Discord token.
- Sessions live in a signed cookie (`cookie-session`, signed with `SESSION_SECRET`) holding just the user's id, name and avatar: `httpOnly`, `sameSite=lax`, and `secure` for requests that came over https (the public URL; see "Public URL"). Logins survive bot restarts and no session table is needed. (The original plan was `express-session` with a SQLite store; the cookie is simpler and needs no database.)
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
- `maxUploadMb` and `guildQuotaMb` (milestone 8): the largest upload, and each server's library space. The status view also shows ffmpeg's version.
- `statusOverride` (after milestone 9): `null` = the automatic Discord status, or `{ type: custom|listening|playing|watching|competing, text (≤128), dot: online|idle|dnd }`. The status view shows the current Discord status and whether it's custom.

**Per server (server admins, Settings tab):**
- `djRoleId` (unset = only admins can control playback; @everyone = every member)
- `defaultVolume`: the volume the bot joins at
- `maxQueueLength`, `maxTrackDurationSec` (optional; livestreams are exempt from the length limit)
- `requireSameVoiceChannel`: while the bot is in a voice channel, DJs must be in it to control playback (default off; admins are exempt)
- `leaveWhenEmptyAfterSec` (default 60; 0 = never leave)
- `announceChannelId` (optional "Now playing" messages; a song repeating or retried with yt-dlp isn't announced again)
- `uploadPermission` (milestone 8): `dj` | `admin` | `off`. "off" refuses everyone, admins too; they can change the setting.

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
- **Spotify links:** built without keys (see "Spotify links"). If Spotify's embed page stops working, the alternative is the LavaSrc plugin plus a Spotify client ID and secret from the Spotify developer dashboard.
- **Stable public URL:** chosen in milestone 9: Tailscale Funnel (fixed `*.ts.net` URL, free, needs a Tailscale login, no API key in `.env`). The alternatives were Cloudflare quick tunnels (`trycloudflare.com`, a new random URL on every restart, which breaks the OAuth redirect) and a named Cloudflare tunnel (needs a domain on Cloudflare).

## Data (SQLite, built in milestone 6)
`data/bot.db`, opened with `better-sqlite3` in WAL mode. The tables are created by numbered migrations in [src/db/migrations.ts](../src/db/migrations.ts); SQLite's `user_version` counts how many have run.
- `global_settings(key PRIMARY KEY, value)`: the value is JSON
- `guild_settings(guild_id PRIMARY KEY, dj_role_id, default_volume, max_queue_length, max_track_duration_sec, require_same_vc, leave_after_sec, announce_channel_id)`: no row = the defaults
- `player_state(guild_id PRIMARY KEY, voice_channel_id, text_channel_id, current_item_json, position_ms, paused, volume, loop_mode, filter, updated_at)`
- `queue_items(guild_id, position, item_json)`: one row per `QueueItem`; position 1 plays next
- `history_items(guild_id, position, item_json)`: "Recently played"; position 1 is the newest (20 per server)
- `playlists`, `playlist_items` (migration 2, milestone 7): see "Playlists".
- `loudness(song_key PRIMARY KEY, loudness_lufs, true_peak_dbtp, measured_at)` (migration 4): each song's measured loudness, for volume normalization. Migration 4 also adds `guild_settings.normalize_volume`.
- Migration 5 adds `guild_settings.auto_announcements`: the automatic announcements as JSON (NULL = the defaults). Each one is laid over its default when read, so one added later starts with its default.
- Migration 6 adds `guild_settings.voice_id` (NULL = the default voice) and `guild_settings.speech_speed` (1 = normal).
- `library_files(id, guild_id, file_name, original_name, title, artist, duration_ms, size_bytes, uploaded_by_id, uploaded_by_name, created_at)` (migration 3, milestone 8). `file_name` is `<id>.<extension>` inside `data/library/<guild_id>/`; a full path isn't stored, so the data folder can move. Migration 3 also adds `guild_settings.upload_permission`.

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
- **Save the queue as a playlist (DJ):** the Player tab's **Up next** section has **Save as playlist**, which opens an inline name form. It turns the current track plus the queue into a new playlist and leaves playback running.
- **Pasting a playlist link into "Add a song" or `/play`:** by default only the selected video is queued. A checkbox on the website (`wholePlaylist: true` on `POST /queue`) and `/play playlist: True` queue every song instead, using the same import.
- Limits: names up to 50 characters, unique per server ignoring upper/lower case; at most 500 songs per playlist. When a playlist plays, the server's queue limit and longest-song setting apply; songs left out are counted in the reply.
- Rename and reorder are on the website only; Discord has `/playlist remove` for removing by position.
- Only playing a playlist follows `requireSameVoiceChannel`; editing playlists isn't controlling playback.
- Spotify albums and playlists import too (see "Spotify links"), at most 100 songs.

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

## Text search (built in milestone 9)
- Input that isn't an http(s) link is a search (at most 200 characters). With the owner's `youtubeMode`: `lavalink` searches through the YouTube plugin, `ytdlp` with `yt-dlp --flat-playlist -J ytsearch1:<query>`, `auto` the plugin first.
- The plugin searches YouTube Music (`ytmsearch:`) first: it returns the song's album audio, where YouTube returns the music video (often with an intro). Plain YouTube (`ytsearch:`) is asked when YouTube Music finds nothing. Tested 2026-10-26: about 0.4 s each through Lavalink, 2 s through yt-dlp.
- The first result's link is queued, not the search, so the song can't change before it plays ("Resolve at play time" re-loads the link).
- Works in `/play`, "Add a song", `/playlist add` and adding to a playlist on the website. Not for YouTube playlist imports, which need a link.
- Possible later: choosing from the top 5 results (Discord autocomplete on `/play`, a results list on the website).

## Spotify links (added after milestone 9, at the owner's request)
- Spotify doesn't allow streaming its audio, so a Spotify song is played from YouTube: the bot reads its artists and title and runs the text search with them. The found link is queued or saved, like any search.
- Read from Spotify's embed page (`open.spotify.com/embed/<type>/<id>`, JSON in its `__NEXT_DATA__` tag): no account or API keys. The owner chose this over the LavaSrc plugin, which needs a Spotify developer app. It isn't an official API, so it can break when Spotify changes the page; all of it is in `src/player/resolvers/spotify.ts`.
- Accepted: `open.spotify.com/{track,album,playlist}/<id>` (also `/intl-xx/`, `/embed/`), and `spotify:track:<id>` URIs. Not accepted: artists, podcasts, `spotify.link` short links.
- Tracks work wherever a link does. Albums and playlists: `/play` and "Add a song" always queue all of them; `/playlist import` and the website's import (DJs) save them. The embed page lists at most 100 songs. Songs are searched 4 at a time (tested 2026-10-26: 100 songs in 14 s through Lavalink); ones with no match are left out and counted.

## Public URL (built in milestone 9)
- `npm run funnel` runs `tailscale funnel <WEB_PORT>` in the foreground: the website is public while it runs, which suits the owner starting everything by hand. The server keeps listening on 127.0.0.1.
- Express trusts `X-Forwarded-*` from loopback only (`trust proxy: loopback`); Funnel sets `X-Forwarded-Proto: https`, so `req.secure` is right and the session cookie is `secure` exactly for https requests.
- OAuth: logins started on `localhost` use the localhost redirect; the rest use `OAUTH_REDIRECT_URI` (`<PUBLIC_URL>/api/auth/callback`). Both are registered in the Developer Portal, so local logins work while Funnel is off.
- `npm run dev` serves the website only to local requests (Vite's dev server can serve project files); the public website is the build (`npm run build`, `npm start`).
- Not done (the owner's choice): running as a background service (pm2, NSSM or a logon task). The owner starts Lavalink, the bot and the funnel themselves.

## Volume normalization (added after milestone 9, at the owner's request)
- Like Spotify's "Normalize volume": each song is measured once with ffmpeg (EBU R128: integrated loudness and true peak) and played with a gain that brings it to -14 LUFS, through Lavalink's volume filter. Quiet songs are raised only while their true peak stays under -1 dBTP, at most +10 dB; loud songs are lowered at most 15 dB.
- Chosen over the LavaDSPX plugin's "normalization" filter, which only attenuates peaks: it doesn't raise quiet songs, and peak level says little about how loud a song sounds.
- Per server, on or off, kept across restarts; DJs switch it (`/normalize`, the website's player). Off by default.
- Measurements are cached per song in SQLite, shared by all servers. A song waits at most 3 s for its measurement; the next queued song is measured ahead. Tested 2026-10-27: about 1 s per song through the YouTube plugin's stream endpoint, 0.1 s for a library file.
- Not measured (played unadjusted): livestreams, and links only Lavalink can read (SoundCloud and Twitch through Lavalink).

## Announcements (text-to-speech, added after milestone 9, at the owner's request)
- DJs type something and the bot says it in the voice channel: `/announce <text>` and the **Announce** box on the website's Player tab. At most 300 characters; one announcement at a time per server.
- **Voice: Piper** (offline neural text-to-speech; `npm run setup:piper` puts it in `bin/piper/`). Chosen over the built-in Windows voices (robotic), free online voices through a Lavalink plugin (the text leaves the PC, and they break like the YouTube plugin does) and paid services (keys, costs). The Windows program comes from Piper's 2023.11.14-2 release, the last one with a ready-made `.exe`; newer versions are only a Python package. That program only runs voices whose pronunciation comes from eSpeak, which rules out Piper's Japanese voice.
- **Voices** (added after the announcements, at the owner's request): ten picked voices (`VOICES` in `src/shared/voices.ts`): seven English (American and British, men and women), two German, one Latvian, about 63 MB each. Only voices on that list can be downloaded or used. The bot owner downloads and deletes them on the Admin page (from Piper's collection on Hugging Face); `npm run setup:piper` downloads the default, `en_US-lessac-medium`, which can't be deleted. Each server picks a downloaded voice and a speaking speed (0.5× to 2×) on its Settings page, with a ▶ Listen button that plays a sample in the browser. A server whose voice was deleted speaks with the default. Messages aren't translated: with a German or Latvian voice, admins write them in that language.
- **Foreign writing:** the English voice only reads Latin letters (and Korean); for anything else it says the alphabet's name ("Japanese letter"). So the text is first spelled in Latin letters: Japanese in romaji (kuroshiro with its kuromoji dictionary), Chinese in pinyin (pinyin-pro), other alphabets with any-ascii. Chosen over switching to a Japanese or Chinese voice for those words: Piper's Japanese voice needs the newer, Python-only Piper, and changing voices mid-sentence sounds like two people. The price is an English accent. Each phrase (between commas and full stops) with any kana in it is read as Japanese; otherwise its Chinese characters are read as Chinese, so a title written only in kanji is read as Chinese.
- **Same voice path:** Piper writes a WAV file to `data/tts/`, Lavalink plays it through its local source, and the file is deleted afterwards.
- **The song pauses for it:** Lavalink plays one track per server, so it can't speak over the music. The speech replaces the song, then the song continues from the same spot (still paused, if it was). The effect and the normalization volume are switched off while it speaks and come back with the song. Other controls (skip, seek, …) wait until the song is back. With nothing playing, the bot just speaks, joining the DJ's voice channel if needed.
- **Automatic announcements** (`autoAnnouncements` in the server's settings): four the bot says by itself, each switched on and worded by server admins on the Settings tab. All off by default. Words in `{curly brackets}` are filled in; text that comes out longer than 300 characters is cut short.
  - **Before a song** (`{song}`, `{artist}`, `{user}`): said in the gap before the song starts, so the song itself isn't interrupted. "Every song" or "Only when the music starts" (a song that starts while nothing was playing). A song on repeat is announced once; a song continuing after a restart isn't.
  - **When a saved playlist starts** (`{playlist}`, `{songs}`, `{user}`): said together with the song announcement, before the first song, when the playlist's first song starts right away (Play, or Add to queue with nothing playing).
  - **When someone joins / leaves the bot's voice channel** (`{name}`): people who join (or leave) within 3 seconds of each other are named together ("Welcome, Ann and Bob!"); the same person isn't announced again within a minute; no goodbye to an empty channel; bots are ignored. Skipped while another announcement is being said, so they don't pile up.
  - If Piper fails, the song plays anyway and the reason is logged.

## Real-time (Socket.IO, built in milestone 4)
- The client sends `guild:watch <id>` and joins the room `guild:<id>`. From milestone 5, the server first checks that the logged-in user is a member of that server.
- Server → client: `state` (full snapshot on join), `queue:update`, `track:start`, `track:end`, `player:update` (position, paused, volume, loop mode, filter; about once per second while playing), `error`, `playlists:update` (milestone 7), `library:update` (milestone 8). The types live in `src/shared/types.ts`.
- **Changes go over REST; sockets only push updates.** This keeps authorization and validation in one place.
- The website shows when Lavalink is down. `lavalink-client` reconnects by itself, but playback fails until it does.

## Interfaces

### Website layout

The Player tab puts the current song in a full-width section at the top: artwork and title, then progress and playback controls. Audio effects expand below the controls, with the active effect shown in the summary. Adding a song belongs with the queue: the form sits under **Up next**, outside a height-limited, keyboard-scrollable song list. **Recently played** sits beside the queue on wide screens and follows it on smaller screens, with a **+** action to queue a song again. Neutral surfaces, text-style secondary actions, list dividers and underlined navigation follow the system's light/dark theme. Artwork has a consistent fallback when an image is unavailable. On phones, row actions wrap below song details; move buttons remain available where dragging is unsupported. This layout uses the existing API and permission checks.

The Settings tab groups controls into expandable Permissions, Playback and Announcements sections, with current draft values summarized while closed. Save changes and Discard remain available in a sticky footer. Automatic voice messages reveal their editors only when enabled. The Playlists tab starts with a name and Create playlist action; importing from YouTube or Spotify is optional and expands to show its link field. These changes keep the existing settings and playlist APIs and permission checks.

### Bot status
The bot's Discord status says what it's doing, summed up over all servers (a bot has one status): "Listening to *title – artist*" (or "music in N servers"), "⏸ Paused: *title*", "Waiting for /resume: *title*" after a restart, "Waiting for a song · /play" in voice with an empty queue, or "Idle · /play to start" (with the idle moon). At most one update every 5 seconds. The owner can replace it with a fixed status on the Admin page (`statusOverride`); clearing that brings the automatic one back. Added at the owner's request after milestone 9 (`src/bot/presence.ts`).

### Slash commands
`/play <song name|url> [playlist] [next]` · `/play file:<attachment> [next]` · `/playlist …` (see "Playlists") · `/skip` · `/stop` · `/pause` · `/resume` · `/queue` · `/nowplaying` · `/remove <pos>` · `/move <from> <to>` · `/playnow <pos>` · `/shuffle` · `/loop off|track|queue` · `/volume <0-150>` · `/filter <effect>` · `/normalize on|off` · `/announce <text>` · `/seek <time>` · `/library list|play|upload|delete` · `/dashboard` (link to the website)

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
POST   /guilds/:id/queue           (dj) { input: string, wholePlaylist?: true, next?: true } | { fileId: string }
                                   next: true puts the new songs in front of the queue ("Play next")
DELETE /guilds/:id/queue/:itemId   (dj)
PATCH  /guilds/:id/queue/:itemId   (dj) { position: number }    1 = play next
POST   /guilds/:id/queue/:itemId/play   (dj) play it now, skipping the current track
POST   /guilds/:id/queue/shuffle   (dj)
DELETE /guilds/:id/queue           (dj) empty the queue; the current track keeps playing
DELETE /guilds/:id/history         (dj) empty "Recently played"
POST   /guilds/:id/player/skip | pause | resume | stop   (dj)
POST   /guilds/:id/player/seek     (dj) { positionMs }
POST   /guilds/:id/player/volume   (dj) { volume }
POST   /guilds/:id/player/loop     (dj) { mode }
POST   /guilds/:id/player/filter   (dj) { filter }
POST   /guilds/:id/player/normalize (dj) { enabled: boolean }   volume normalization, a server setting
POST   /guilds/:id/player/announce  (dj) { text }               says it in voice (text-to-speech); answers once it's been said
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

Built in milestone 8:
```
GET    /guilds/:id/library          (member) the files, newest first, plus space used, limits and the upload setting
POST   /guilds/:id/library          (uploadPermission) multipart, one file in the field "file", header X-Requested-With: music-bot
DELETE /guilds/:id/library/:fileId  (dj)
```
