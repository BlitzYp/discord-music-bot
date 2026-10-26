# How it works

A walk through the code: what happens when someone types `/play`, why things are split the way they are, and how to add your own command.

## The two processes

```
Discord ──slash command──▶ Node.js bot (this repo) ──REST/WebSocket──▶ Lavalink (Java)
                                                                          │
Discord voice channel ◀──────────────────── audio ────────────────────────┘
```

- **The bot** (TypeScript, `src/`) handles commands, keeps the queue and decides what plays next.
- **Lavalink** (`lavalink/Lavalink.jar`) downloads and decodes the audio and streams it into the voice channel. The bot only ever tells it "play this track now", "stop" and so on.

The bot talks to Lavalink through the [`lavalink-client`](https://github.com/Tomato6966/lavalink-client) library.

## The layers

| Layer | Files | Job |
|---|---|---|
| Commands | `src/bot/commands/*.ts` | Read the command's options, call `PlayerManager`, reply. No playback logic. |
| PlayerManager | `src/player/PlayerManager.ts` | The single entry point for playback. Finds the right server's `GuildPlayer` and runs the action. |
| GuildPlayer | `src/player/GuildPlayer.ts` | One server's state: `current` (playing now) and `queue` (up next). |
| Resolvers | `src/player/resolvers/` | Turn a link into a track Lavalink can play. |
| PlaylistManager | `src/playlists/PlaylistManager.ts` | Each server's saved playlists. See [Playlists](#playlists). |
| LibraryManager | `src/library/LibraryManager.ts` | Each server's uploaded audio files. See [The library](#the-library). |
| Database | `src/db/` | Settings, each server's saved playback, playlists and library files (SQLite). See [Settings and the database](#settings-and-the-database). |

The rule that holds it together: **commands and the website only call `PlayerManager` (and, for playlists and the library, `PlaylistManager` and `LibraryManager`) methods.** If Discord and the website both go through the same methods, they can never show different queues.

## What happens on `/play <link>`

1. **`events/interactionCreate.ts`** receives the command, looks it up in `commands/index.ts` and calls `play.execute()`. It also catches errors (see [Errors](#errors)).
2. **`commands/play.ts`** calls `deferReply()` first, because Discord wants a response within 3 seconds and loading a link can take longer. Then it calls `players.play(guildId, { input, requestedBy, voiceChannelId, textChannelId })`.
3. **`PlayerManager.play()`**:
   1. `GuildPlayer.ensureConnected()` joins the requester's voice channel, unless the bot is already in one. (After a restart it also continues the interrupted song; see [Surviving a restart](#surviving-a-restart).)
   2. `findSong()` (`resolvers/index.ts`) turns the input into a song. A link is labelled `youtube` or `url` by `parseInput()` and loaded by `fetchMetadata()` through Lavalink to get the title, duration and thumbnail. Anything else is searched for on YouTube (see [Text search](#text-search)). `checkDurationLimit()` refuses songs longer than the server's limit.
   4. `GuildPlayer.enqueue()` either plays it right away (if nothing was playing) or adds it to the end of the queue, unless the queue is at the server's limit.
4. Back in `play.ts`, the reply says "Now playing ..." or "Queued at #3 ...".

## What happens when a track ends

Lavalink tells the bot when a track ends, and why. `PlayerManager.listenToLavalink()` passes that on to `GuildPlayer.onTrackEnded(reason)`:

- `finished`: the track played to the end. The loop mode decides what's next:
  - `off`: play the next item; the finished one is dropped.
  - `track`: play the same item again.
  - `queue`: put the finished item at the end of the queue, then play the next one.
- `loadFailed`: Lavalink couldn't play it. Play the next item. A broken item is never looped, so one bad link can't fail over and over.
- `stopped`, `replaced` or `cleanup`: the bot caused it itself (`/stop`, `/skip` and so on), so do nothing.

`playNext()` takes the next item off the queue and **loads its link again** right before playing it (see below). If that fails, it reports the error in the channel and tries the item after it. When the queue is empty the bot goes quiet but stays in the voice channel.

`/skip` drops the current item, or, in `queue` loop mode, moves it to the end of the queue. Every new track starts unpaused, because Lavalink would otherwise stay paused across a skip.

Tracks that played to the end or were skipped go into `GuildPlayer.history` (newest first, the last 20; a track on repeat is listed once). Tracks that failed don't. The website shows it as "Recently played". It survives `/stop`, and it's saved with the queue, so it survives restarts too.

## Lavalink first, yt-dlp as the backup

There are two ways to turn a link into something Lavalink can play (`src/player/resolvers/`). (Library files are a third case, with no fallback: see [The library](#the-library).)

- **`lavalink`**: Lavalink loads the link itself (`resolvers/lavalink.ts`). Fast, and the normal path.
- **`ytdlp`**: yt-dlp downloads the audio into `data/ytdlp-cache/`, and Lavalink plays the file from disk (`resolvers/ytdlp.ts`). Slower (about 10 seconds per song), but yt-dlp keeps up with YouTube's changes faster than Lavalink's plugin, and it supports SoundCloud, which Lavalink 4.2.2 can't play.

`methodsFor(source, youtubeMode)` in `resolvers/index.ts` decides which methods to try, in order. For YouTube that depends on the owner's `youtubeMode` setting on the Admin page (`auto` = Lavalink then yt-dlp); every other site gets Lavalink then yt-dlp. `resolvePlayable()` tries them until one works. The setting is read for every song, so changing it applies from the next one.

Why download instead of handing Lavalink yt-dlp's audio URL (`yt-dlp -g`)? Tested 2026-10-25: YouTube answers those URLs with 403 Forbidden unless the request comes from yt-dlp itself.

A link can also *load* fine through Lavalink and then fail while *playing* (YouTube blocking the plugin did exactly this). Then:

1. Lavalink reports a track error. `GuildPlayer.onTrackError()` sees that the track came from `lavalink` and that `ytdlp` is still left to try, so it records a `pendingRetry` (including how far playback got) and tells `PlayerManager` not to show the error.
2. Lavalink then ends the track with reason `loadFailed`. `onTrackEnded()` finds the pending retry and plays the same item again with yt-dlp, from the same position.
3. If yt-dlp fails too, that error *is* shown, and the queue moves on.

Downloads are shared and cached by URL (the last 20 songs), so looping a song doesn't download it again. The cache is emptied on every start, and the bot runs `yt-dlp -U` at startup to stay current.

### Text search

`/play`, "Add a song" and adding to a playlist accept a song's name as well as a link: `findSong()` treats anything that isn't an http(s) link as a search. `searchYoutube()` follows the owner's YouTube setting, like a YouTube link does:

- **Lavalink** (`searchWithLavalink()` in `resolvers/lavalink.ts`): the YouTube plugin searches YouTube Music (`ytmsearch:`) first, because it finds the song itself (album audio) where YouTube finds the music video, often with an intro or a skit; then plain YouTube (`ytsearch:`) if that found nothing. Each takes about half a second.
- **yt-dlp** (`searchYoutubeWithYtDlp()` in `resolvers/ytdlp.ts`): `yt-dlp --flat-playlist -J "ytsearch1:<query>"`, about 2 seconds.

Only the first result is used, and what's queued is that result's **link**, not the search: searching again when the song's turn comes could find a different video. From there on it's a normal YouTube item.

### Why load the link again right before playing?

The queue stores what the user typed (the link), not a ready-to-play track. Some playable URLs expire: Discord attachment links after about a day, and the direct audio URLs yt-dlp produces after a few hours. Loading at play time means a song that waited in the queue for a long time still works. (Library files store the file's id, looked up when it plays, so a deleted file is noticed then.)

### Why does GuildPlayer keep its own queue?

`lavalink-client` has a queue built in, but it stores resolved tracks, which is exactly what the previous section avoids. So the bot keeps its own queue and turns the library's automatic skipping off (`autoSkip: false` in `player/lavalink.ts`). A side effect: because the library's queue is always empty, it reports every track end as `queueEnd` instead of `trackEnd`. That's why `PlayerManager` listens to `queueEnd`.

### Queue positions and item ids

Users see queue positions: the numbers in `/queue`, where 1 is the next track. `PlayerManager` identifies items by their `id` instead (`remove(guildId, itemId)`, `move(guildId, itemId, toPosition)`), because a position can change between the moment someone reads the queue and the moment they act on it. The website will send ids. Slash commands translate a position into an id with `itemAtPosition()` in `src/bot/commands/positions.ts`.

### Leaving an empty channel

`bot/events/voiceStateUpdate.ts` watches people joining and leaving voice channels. Whenever the bot's channel changes, it counts the people in it (`countListeners()` in `bot/voice.ts`; bots don't count) and calls `players.updateListenerCount()`. When the count hits 0, `PlayerManager` starts a timer for the server's `leaveWhenEmptyAfterSec` setting (60 seconds by default; 0 means never leave). If someone joins in time, the timer is cancelled; otherwise the bot does a normal `/stop`.

### Audio filters

Effects (`/filter` in Discord, the Effects buttons on the website) are built into Lavalink; the bot only picks settings. `src/player/filters.ts` maps each name to `lavalink-client` helpers (nightcore and vaporwave change speed and pitch, bassboost is an equalizer preset, 8d is rotation, and so on). `applyFilter()` first resets everything, so exactly one effect is ever active. Lavalink keeps filters on the player, so they carry over to the next songs; a new player (after the bot leaves voice) starts without effects, which is why `GuildPlayer.reset()` sets `filter` back to `off`.

The list of effects, their descriptions and the nightcore/vaporwave speed settings live in `src/shared/filters.ts`, so Discord and the website always offer the same effects.

**Positions under speed effects.** Nightcore plays a song 1.21× faster and vaporwave 0.85× slower, but Lavalink keeps reporting the position in *real* time (tested 2026-10-25: a 2:37 song ended while Lavalink said ~2:16). So `GuildPlayer` works out the song position itself (`songPositionMs()`): the position at the last moment Lavalink and the song agreed (a track start or an effect change), plus the real time since then × `playbackRate()`. Every effect change also seeks to the current song position. That makes the new effect audible immediately (instead of after the ~5 seconds of audio Lavalink has already prepared) and makes the two agree again. The snapshot's `positionMs` is always song time; the website counts up between updates at `playbackRate()` as well. A future `/seek` must reset `speedAnchor` the same way.

To add an effect: add its name to `AUDIO_FILTERS` and a description to `FILTER_DESCRIPTIONS` in `src/shared/filters.ts`, then add a `case` in `src/player/filters.ts`. The `/filter` choices and the website's buttons are built from that list.

### `run()`: one change at a time

Every change to a `GuildPlayer` goes through `player.run(() => ...)`. That waits for the previous change in that server to finish before starting the next one. Without it, a `/skip` arriving at the same moment a track ends by itself could advance the queue twice.

## The website

The website runs inside the bot's own process (`src/web/`), so it reads the same `PlayerManager` the slash commands use. `src/web/server.ts` puts three things on one port (`WEB_PORT`, default 3000):

| Part | File | Job |
|---|---|---|
| REST API | `src/web/routes/` | `auth.ts` (login), `guilds.ts` (your servers, a server's state), `player.ts` (the controls), `playlists.ts` (the Playlists tab), `library.ts` (the Library tab and uploads), `settings.ts` (a server's settings), `admin.ts` (the owner's Admin page) |
| Socket.IO | `src/web/socket.ts` | Pushes every change to the browsers watching that server |
| The React app | `src/web/frontend.ts` | Serves `web/`: through Vite when running from source (`npm run dev`, instant reloads), or the built `web/dist/` with `npm start` |

**Page layout.** `web/src/App.tsx` puts the full-width `NowPlaying` section first on the Player tab. Its artwork and title lead, followed by progress, playback controls and a collapsible `EffectPicker`; the summary shows the active effect even when closed. `QueueList` accepts the DJ-only `AddSong` form as a child, placing it under the **Up next** heading and outside the scrolling song list. That list can be focused and scrolled with the keyboard. The queue and `HistoryList` share a `player-lists` grid: side by side on wide screens, stacked on smaller screens. The **+** history action adds a song to the queue again. `TrackArtwork` is shared by the player, queue, history and playlist view; it keeps a music-note fallback if an image fails and loads list artwork lazily. Styling in `web/src/styles.css` follows the system's light/dark theme with neutral surfaces, underlined navigation, visible keyboard focus and row actions that wrap below song details on phones.

How the page stays live:

1. The browser opens a Socket.IO connection and sends `guild:watch` with the server's id (`web/src/useGuildState.ts`).
2. `socket.ts` checks that the logged-in user is a member of that server, puts the connection in the room `guild:<id>`, and answers with `state`, a full `PlayerSnapshot`.
3. From then on, every `PlayerManager` event for that server is forwarded to the room: `queue:update` (with a full snapshot) whenever the current track or the queue changes, and `player:update` (position, paused, volume, loop mode, filter) whenever those change and about once a second while playing. `playlists:update` says a playlist changed (see [Playlists](#playlists)), `library:update` that the library did (see [The library](#the-library)).
4. Between updates, `NowPlaying` keeps the progress bar moving by counting up from the last position.

The message types are defined once in `src/shared/types.ts` (`ServerToClientEvents`, `ClientToServerEvents`), and both sides import them, so the TypeScript compiler catches it if the bot and the website disagree. The website imports shared code through `web/src/shared.ts`.

Changes from the website go through REST routes (`src/web/routes/player.ts`), never the socket, so permissions are checked in one place. Buttons call the functions in `web/src/api.ts`. The page doesn't apply a change itself: it waits for the socket's update, exactly as if someone had used the slash command in Discord, so the two can't disagree.

`src/web/http.ts` has `route()`, a wrapper for async route handlers: an `HttpError` becomes its status (401, 403, 404…), a `NotAllowedError` 403 and any other `UserError` 400 with its message, anything else a 500 with the details logged to the console.

### The public address (Tailscale Funnel)

The server listens on `127.0.0.1` only. `npm run funnel` (`scripts/funnel.mjs`) runs `tailscale funnel <WEB_PORT>` in the foreground: Tailscale answers `https://<pc>.<tailnet>.ts.net` and passes each request on to this port, from this computer, so the website is public exactly while that runs. Before starting, the script checks that Tailscale is logged in and warns if `PUBLIC_URL` doesn't match the PC's address. Four things make the server work behind it:

- **https, as Funnel saw it.** Funnel connects over plain http but adds `X-Forwarded-Proto: https`. `app.set("trust proxy", "loopback")` (`server.ts`) lets Express believe that header from this computer only, so `req.secure` is true for public requests.
- **The session cookie** (`session.ts`) is made https-only per request (`req.sessionOptions.secure = req.secure`), not from `PUBLIC_URL`: the cookie library refuses to send an https-only cookie on a request it thinks is http, and browsers would drop one on http://localhost.
- **Two login addresses.** `isLocalRequest()` (`requests.ts`) tells this computer's requests (Host `localhost`, no `X-Forwarded-For`) from public ones. `redirectUriFor()` in `routes/auth.ts` sends logins started on this computer back to `http://localhost:<port>/api/auth/callback` and the rest to `OAUTH_REDIRECT_URI`, so logging in on the bot's PC works whether or not the public address is on. Both must be registered in the Developer Portal.
- **The development website stays local.** With `npm run dev`, Vite's development server serves the page, and it can hand out other project files (source, even `data/bot.db`), so `frontend.ts` answers public requests with a 503 "run it with npm start" instead. The REST API and the socket work either way; `npm start` serves the built `web/dist/` to everyone.

Logins and permission checks were built for this from milestone 5: every API route checks the logged-in user's level, and uploads need the custom header (see [The library](#the-library)).

## Playlists

Saved, per-server playlists (milestone 7). The rules live in `PlaylistManager` (`src/playlists/PlaylistManager.ts`), so `/playlist` (`src/bot/commands/playlist.ts`) and the website's Playlists tab (`src/web/routes/playlists.ts`, `web/src/components/PlaylistsPage.tsx` and `PlaylistView.tsx`) behave the same.

| File | Job |
|---|---|
| `db/playlistStore.ts` | `PlaylistStore`: the `playlists` and `playlist_items` tables. Only stores; every lookup by playlist id also takes the server's id, so an id from one server can't reach another server's playlist. |
| `playlists/PlaylistManager.ts` | Names (tidied, at most 50 characters, unique per server ignoring case), the 500-song limit, who may remove which song, importing, saving the queue, and playing. Emits `change` after every edit. |
| `shared/playlists.ts` | The types and limits, shared with the website, plus `isYoutubePlaylistLink()` and `describeAddMany()` (the "Queued 12 songs…" text). |

**Songs are links.** A playlist song stores what a queue item stores: the `TrackSource` plus the title, length and thumbnail read when it was added. Like queued songs, it's loaded only when it plays ("Resolve at play time"), so a playlist can't go stale.

**Adding a song** loads the link once through `fetchMetadata()` (the same as `/play`) to read its title and length. **Importing** a YouTube playlist uses `listPlaylist()` in `player/resolvers/index.ts`, which runs `yt-dlp --flat-playlist -J`: it lists up to 500 videos' links, titles and lengths from the playlist page in a few seconds (182 videos took 4 s when tested), without downloading anything. Private and deleted videos are skipped. The bot is a logged-out visitor to YouTube, so YouTube answers "The playlist does not exist" for private playlists and for personal mixes (Replay Mix, My Supermix: ids starting with `RD` that only their signed-in owner can see); `explainPlaylistError()` turns that into a message saying what to do instead. A personal mix opened from one of its songs loads with just that one song, so an `RD` list with one song or none gets the same message. Mixes started from a song (`watch?v=X&list=RDX`) are public and import normally.

**Playing** turns each song into a new `QueueItem` (a fresh id, requested by whoever pressed Play) and calls `PlayerManager.addMany()`:
1. Songs longer than the server's `maxTrackDurationSec` are left out and counted.
2. `"append"`: join voice if needed (`ensureConnected()`), then `GuildPlayer.enqueueMany()` adds as many as the queue limit allows; if nothing was playing, the first one that loads starts.
3. `"replace"`: `GuildPlayer.replaceQueue()` joins voice first (so "join a voice channel first" leaves the queue alone), drops the current track (into "Recently played", like a skip) and the queue, then calls `enqueueMany()`. The old track keeps playing until the first new song starts over it, and Lavalink then ends the old one with reason `replaced`, which `onTrackEnded()` ignores. After a restart it joins with `{ continueInterrupted: false }`, so the interrupted song isn't started only to be replaced.

The answer (`AddManyResult`) says how many songs were queued, too long, or past the queue limit. **Every song of a playlist link** (`/play playlist: True`, or the checkbox under "Add a song") uses the same path: `PlayerManager.playPlaylistLink()` lists the playlist with yt-dlp and appends it with `addMany()`.

**Who may do what** differs per subcommand: anyone may list, show, add songs, and remove their own songs; the rest is for DJs. Only playing controls playback, so only that follows the server's "Only from the bot's voice channel" setting (see [Login and permissions](#login-and-permissions)). Removing someone else's song as a member throws `NotAllowedError` (a `UserError` that the website answers with 403).

**Live updates.** `PlaylistManager` emits `change` with the server's id; `src/web/socket.ts` forwards it as `playlists:update` to that server's room. It carries no data: the Playlists tab just loads the list and the open playlist again (`usePlaylistChanges()` in `PlaylistsPage.tsx`), so a song added with `/playlist add` appears on everyone's page.

## The library

Each server's uploaded audio files (milestone 8). The rules live in `LibraryManager` (`src/library/LibraryManager.ts`), so `/play file:`, `/library` (`src/bot/commands/library.ts`) and the website's Library tab (`src/web/routes/library.ts`, `web/src/components/LibraryPage.tsx`) behave the same.

| File | Job |
|---|---|
| `db/libraryStore.ts` | `LibraryStore`: the `library_files` table. Only stores; like playlists, every lookup by file id also takes the server's id. |
| `library/LibraryManager.ts` | Adding (checking, converting, storing), deleting, finding files by what was typed, queuing, the size limits and the upload setting. Emits `change` after every edit. |
| `library/ffmpeg.ts` | `probeAudio()` runs ffprobe; `convertToOpus()` runs ffmpeg. |
| `library/paths.ts` | Where files live: `data/library/<guildId>/<fileId>.<extension>`, and `data/library/.incoming/` for uploads being checked. |
| `shared/library.ts` | The types, the upload setting's values and `formatBytes()`, shared with the website. |

**Adding a file** (`LibraryManager.addFile()`):
1. The upload is already saved in the incoming folder under a random name: by multer for the website (`receiveUpload()` in `routes/library.ts`), or by `addAttachment()`, which downloads a Discord attachment. Discord's attachment links expire after about a day, which is why the file is copied instead of queued as a link.
2. `probeAudio()` asks ffprobe what the file is: its container, the first audio stream's codec, whether there's a real video stream (album art doesn't count), the length and the title/artist tags. No audio stream, or a file ffprobe can't read, is refused.
3. `playableExtension()` compares that with `PLAYABLE_AS_IS`, the formats Lavalink plays directly (MP3, FLAC, 16-bit WAV, OGG, M4A/AAC, WebM). Anything else, and anything with video, goes through `convertToOpus()`. Tested 2026-10-26: AIFF and WMA don't load in Lavalink at all, and after converting they do.
4. The size is checked against the owner's `maxUploadMb` and the server's free space (`guildQuotaMb` minus what its files use) before and after converting, since converting can change the size and other uploads may finish meanwhile.
5. The file is moved to the server's folder as `<random id>.<extension>` and gets a row in the database. The uploaded name is only shown; it's never part of a path.

The incoming file is deleted whatever happens (`finally`), and `cleanUp()` empties the incoming folder on every start, in case the bot stopped mid-upload.

**Playing a file.** A library file in the queue is a `TrackSource` of kind `"file"` with the file's id. `LibraryManager.play()` builds the `QueueItem` from the database row (title, artist, length) and hands it to `PlayerManager.playItem()`, so no link needs loading. When its turn comes, `resolvePlayable()` (`resolvers/index.ts`) looks the id up through `PlayerManager.libraryFilePath()`, which only finds files of that player's server, and loads the path through Lavalink's local source, the same way yt-dlp downloads play. Its method is `"file"`, which has nothing to fall back to. A file deleted while it waited in the queue fails with "That file was deleted from the library" and the queue moves on. Playlists and "Recently played" keep file items like any other song, so they work there too.

**Deleting.** The row goes first, then the file. Windows won't delete a file that's open, and Lavalink keeps the playing file open, so deleting the song that's playing leaves the file on disk; `cleanUp()` deletes files the database no longer knows on the next start.

**Who may do what.** Looking is for everyone. Deleting and queuing need a DJ. Uploading follows the server's `uploadPermission` setting (`dj`, `admin` or `off`), checked by `checkCanUpload()` before any data is received: in `routes/library.ts` right after `requireGuildAccess()`, and in the commands before they download the attachment. `/play file:` needs both DJ (to play) and upload permission (it saves the file). None of it but queuing controls playback, so only `/library play`, `/play` and `POST /queue { fileId }` follow the same-voice-channel setting.

**Uploads from the website** are multipart, not JSON, so `requireJsonForChanges` (`src/web/http.ts`) lets them through only with the header `X-Requested-With: music-bot`. A plain HTML form on another website could send multipart, but it can't add a custom header without passing a CORS check. The website sends uploads with `XMLHttpRequest` (`uploadToLibrary()` in `web/src/api.ts`) rather than `fetch`, because only it reports upload progress. multer reads file names as Latin-1 while browsers send UTF-8, so `decodeFileName()` reads the bytes again as UTF-8 ("CafÃ©" → "Café").

**Live updates.** `LibraryManager` emits `change`; `src/web/socket.ts` forwards it as `library:update`, and the Library tab loads the list again (`useLibraryChanges()` in `LibraryPage.tsx`), like the Playlists tab does.

## Login and permissions

**Logging in** (`src/web/routes/auth.ts`) uses Discord's OAuth2 with only the `identify` scope:

1. "Log in with Discord" goes to `GET /api/auth/login`, which saves a random `state` in the cookie and sends the browser to Discord's consent page.
2. Discord sends the browser back to `GET /api/auth/callback` with a one-time `code` and the same `state`. A different `state` means the link didn't come from our login, and is refused.
3. The bot swaps the code for an access token, asks Discord who the user is, and stores the user's id, name and avatar in the session cookie. The token is then thrown away.

**The session** (`src/web/session.ts`) is a cookie signed with `SESSION_SECRET`: anyone can read it, but nobody can change it without the secret, and a forged one is ignored. It holds nothing secret, so a cookie is enough; that also means logins survive bot restarts.

**Permission levels** (`src/permissions.ts`, with the level names in `src/shared/permissions.ts`):

| Level | Who | May |
|---|---|---|
| owner | `OWNER_ID` | everything, in every server |
| admin | Administrator or Manage Server | the server's Settings tab, and all controls |
| dj | the server's DJ role (picked on the Settings tab). No role picked = nobody; @everyone = every member | control playback |
| member | anyone in the server | look |

- **Slash commands** declare a `permission` (`src/bot/commands/*.ts`), checked in `bot/events/interactionCreate.ts` using the member Discord sends with the command. A command whose subcommands need different levels (`/playlist`) lists a rule per subcommand in `subcommands`: its `permission`, and `controlsPlayback` (whether the same-voice-channel rule below applies). `ruleFor()` in `commands/types.ts` picks the rule.
- **Web routes** start with `requireGuildAccess(req, client, level)` (`src/web/access.ts`). It answers 401 if nobody is logged in, 404 if the user (or the bot) isn't in that server, and 403 if their level is too low. It looks the member up through Discord's API (no privileged intent needed), cached for 30 seconds, so a role change takes up to 30 s to apply on the website.
- **Same voice channel:** with the server's `requireSameVoiceChannel` setting on, `voiceChannelProblem()` (`src/permissions.ts`) refuses DJ actions from a DJ who isn't in the bot's voice channel. Both paths check it right after the level: `interactionCreate.ts` for commands with `permission: "dj"`, and `requireGuildAccess()` for `"dj"` routes. Admins are exempt. It's about controlling playback, so DJ actions that don't (editing playlists) opt out: subcommand rules with `controlsPlayback: false`, and routes that call `requireGuildAccess(req, ctx, "dj", { controlsPlayback: false })`.
- **The owner's Admin page:** every `/api/admin/...` route starts with `requireOwner(req)`, and `GET /api/me` tells the website whether to show the Admin button (`isOwner`).
- **The socket** only lets a browser watch a server whose member is logged in.
- **The website** shows controls only to DJs (`hasLevel(guild.level, "dj")`), but that's just convenience: every change is checked again on the server.
- Changes must be JSON (`requireJsonForChanges`), and the cookie is `sameSite=lax`. Together these stop another website from making changes through your logged-in browser.

**Lists** (the queue, playlist songs, recently played) show each title with `SongTitle` (`web/src/components/SongTitle.tsx`), a link to the song's page that opens in a new tab. For DJs, the queue and playlist songs can be dragged to reorder: `useDragReorder()` (`web/src/useDragReorder.ts`) uses the browser's own drag and drop, draws a line where the row will land, and on drop calls the same move route as the ↑↓ buttons with the new position. Like every control, the row only moves once the bot's update arrives. Most phone browsers can't drag this way, so the ↑↓ buttons stay.

**To show something new on the page:** if the information is already in `PlayerSnapshot`, just use it in a component in `web/src/components/`. If not, add it to `PlayerSnapshot` in `src/shared/types.ts`, fill it in `GuildPlayer.snapshot()` (and `PlayerManager.getState()` for servers with no player yet), and the compiler will point at anything else that needs updating.

## Settings and the database

Everything the bot remembers lives in one SQLite file, `data/bot.db` (`src/db/database.ts`). `better-sqlite3` is synchronous: a query finishes before the next line runs, so there are no `await`s and no races, and the queries are tiny enough not to hold anything up.

| File | Job |
|---|---|
| `db/migrations.ts` | Creates and updates the tables. Each entry in `MIGRATIONS` runs once; SQLite's `user_version` remembers how many ran. **Change a table by adding an entry**, never by editing one that already ran (existing databases won't run it again). |
| `db/settingsStore.ts` | `SettingsStore`: the owner's global settings (`global()`) and each server's (`guild(id)`), with `updateGlobal()` / `updateGuild()` that save only the given keys. A server without a row gets the defaults. |
| `db/playerStateStore.ts` | `PlayerStateStore`: each server's current track, position, queue and history (see the next section). |
| `db/playlistStore.ts` | `PlaylistStore`: each server's playlists (see [Playlists](#playlists)). |
| `db/libraryStore.ts` | `LibraryStore`: each server's library files (see [The library](#the-library)). |
| `shared/settings.ts` | The settings' types, defaults and allowed ranges, shared with the website. |

Settings are read from the database every time they're needed, not cached, so a change on the website applies to the very next command (and a new DJ role applies at once, even though Discord roles are cached for 30 s). Who reads what:

- `src/permissions.ts`: `djRoleId`, `requireSameVoiceChannel`
- `GuildPlayer`: `defaultVolume` (when joining voice), `maxQueueLength`, `youtubeMode`
- `PlayerManager`: `maxTrackDurationSec`, `leaveWhenEmptyAfterSec`
- `bot/events/playerEvents.ts`: `announceChannelId`
- `src/index.ts`: `ytdlpAutoUpdate` (at startup)
- `LibraryManager`: `maxUploadMb`, `guildQuotaMb`, `uploadPermission`

The website edits them through `routes/settings.ts` (server admins) and `routes/admin.ts` (the owner). Each route checks the body with a zod schema (`parseBody()` in `src/web/http.ts`), so a bad value is answered with a 400 that names the setting, and also checks that a role or channel id belongs to that server.

### How to add a setting

Example: a per-server `maxSongsPerUser`.

1. **Type and default:** add it to `GuildSettings`, `DEFAULT_GUILD_SETTINGS` and, for a number, `SETTING_LIMITS` in `src/shared/settings.ts`.
2. **Column:** add a migration to `MIGRATIONS` in `src/db/migrations.ts`, e.g. `ALTER TABLE guild_settings ADD COLUMN max_songs_per_user INTEGER;`.
3. **Store:** read and write the column in `SettingsStore.guild()` and `updateGuild()` (`src/db/settingsStore.ts`).
4. **Validation:** add it to `guildSettingsChanges` in `src/web/routes/settings.ts`.
5. **Page:** add a `<Field>` to `web/src/components/GuildSettingsForm.tsx`.
6. **Use it** where the rule applies, through `settings.guild(guildId).maxSongsPerUser` (in `PlayerManager` or `GuildPlayer` for playback rules).

A global setting works the same way with `GlobalSettings` (and `GLOBAL_SETTING_LIMITS` for a number), `globalSettingsChanges` in `routes/admin.ts` and `AdminPanel.tsx`, but needs no migration: `global_settings` stores one row per key.

## Surviving a restart

`npm run dev` restarts the bot on every save, and the PC may reboot, so each server's playback is saved as it changes and picked up again on start.

**Saving.** `GuildPlayer.emitQueueUpdate()` (the track or the queue changed) calls `PlayerManager.saveState()`, which rewrites that server's saved state in one transaction. `emitPlayerUpdate()` (pause, volume, loop, effect, seek, and Lavalink's position update about once a second) calls `saveStatus()`, which only updates the `player_state` row. So a crash loses about a second of position, and a killed process needs no clean-up step.

On Ctrl+C, `shutdown()` in `src/index.ts` calls `players.stopSaving()` *before* leaving voice. Leaving voice resets each `GuildPlayer`, which would otherwise save every server as "nothing playing".

**Loading.** `PlayerManager`'s constructor loads every saved server straight away (`GuildPlayer.restore()`), so a command that arrives early continues the saved queue instead of starting a new one. A track that was playing becomes **interrupted**: `GuildPlayer.interrupted` holds where it had got to, the volume and the voice channel, `current` is the track, but the bot isn't in voice. The snapshot shows it paused with `interrupted: true`, and the website labels it "Stopped by a restart".

**Continuing.** `GuildPlayer.ensureConnected()` continues an interrupted track as soon as the bot is in voice again (`continueInterrupted()`: play it from the saved position; if it can't be loaded any more, move on to the next one). Three things call it:

1. **The bot by itself:** once Discord is ready and Lavalink has a session (`continuePlaybackAfterRestart()` in `bot/events/ready.ts`), `players.rejoinAfterRestart()` rejoins the saved voice channel, but only if people are still in it and the track wasn't paused.
2. **`/resume`** (or the website's Resume button), in the requester's voice channel.
3. **`/play`**, which continues the interrupted track and then queues the new one.

While interrupted, `/skip` moves to the next song without playing it (it waits to be continued from its start), `/stop` clears everything, and controls that need the voice connection (pause, seek, volume, effects) answer "Playback stopped when the bot restarted. Use /resume to continue."

Saved items are links, loaded again when they play like any queued item, so links that expired during the downtime don't matter.

## Errors

- Throw **`UserError`** (from `src/player/errors.ts`) when the message is meant for the user, e.g. `throw new UserError("Join a voice channel first.")`. The command handler shows that message as the reply.
- Any other error is a bug or an unexpected failure: it is logged to the console, and the user sees "Something went wrong".
- Errors that happen later, after the command already replied (for example a queued track failing to load), are emitted as `error` events by `PlayerManager`. `bot/events/playerEvents.ts` posts them in the channel where `/play` was used.

## How to add a slash command

Example: a `/clear` command that empties the queue but keeps the current track playing. (Steps 1 and 2 already exist for this one, because the website's Clear button uses them; they're shown as the pattern to follow.)

**1. Add the logic to `GuildPlayer`** (`src/player/GuildPlayer.ts`):

```ts
/** Removes everything waiting in the queue. The current track keeps playing. Returns how many were removed. */
clearQueue(): number {
  const removed = this.queue.length;
  this.queue = [];
  this.emitQueueUpdate(); // saves the change and tells the website
  return removed;
}
```

**2. Expose it on `PlayerManager`** (`src/player/PlayerManager.ts`), going through `run()`:

```ts
async clearQueue(guildId: string): Promise<number> {
  const player = this.players.get(guildId);
  if (!player) return 0;
  return player.run(async () => player.clearQueue());
}
```

**3. Create the command** (`src/bot/commands/clear.ts`):

```ts
import { SlashCommandBuilder } from "discord.js";
import type { Command } from "./types.js";

export const clear: Command = {
  permission: "dj", // who may use it: "member", "dj", "admin" or "owner" (see "Login and permissions")
  data: new SlashCommandBuilder().setName("clear").setDescription("Empty the queue (the current track keeps playing)"),

  async execute(interaction, { players }) {
    const removed = await players.clearQueue(interaction.guildId);
    await interaction.reply(removed > 0 ? `Removed ${removed} tracks from the queue.` : "The queue is already empty.");
  },
};
```

**4. Register it** in `src/bot/commands/index.ts` by adding `clear` to the `commands` array.

Restart the bot (`npm run dev` does this on save). Commands are registered with Discord on every start, so `/clear` appears without any extra step (instantly if `DEV_GUILD_ID` is set).

Things to keep in mind:
- If the command might take more than a couple of seconds (anything that loads a link), call `await interaction.deferReply()` first and answer with `editReply` instead of `reply`.
- Subcommands (`/playlist add`, `/playlist play`…): add them with `.addSubcommand()`, read the chosen one with `interaction.options.getSubcommand(true)`, and give each a rule in `subcommands` if they need different permission levels. `commands/playlist.ts` is the example, including name suggestions while typing (`.setAutocomplete(true)` on the option plus an `autocomplete()` method on the command).
- Command names must be lowercase, with no spaces.
- Keep Discord-specific code (replies, embeds) in the command and playback logic in `GuildPlayer`/`PlayerManager`, so the website can reuse the same methods.
- To offer it on the website too, add a route in `src/web/routes/player.ts` (one `djRoute(...)` line calling the same `PlayerManager` method), a function in `web/src/api.ts`, and a button in a component.

## Configuration files

- **`.env`**: secrets and connection settings. Read and checked in `src/config.ts`; add new variables to the zod schema there and to `.env.example`.
- **`lavalink/application.yml`**: which sources Lavalink may use, plus the YouTube plugin's version and settings. Restart Lavalink after changing it. The password isn't in this file: `scripts/lavalink.mjs` passes it from `.env` when Lavalink starts.
- **The website's Settings tab and Admin page**: everything that isn't a secret or a connection detail. Stored in `data/bot.db` (see [Settings and the database](#settings-and-the-database)).
