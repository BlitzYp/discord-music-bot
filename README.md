# Discord Music Bot

A self-hosted Discord bot that plays music in voice channels. Audio is played by [Lavalink](https://lavalink.dev), a separate Java server that runs next to the bot on the same machine.

**Status:** milestone 6 of 9 (see the milestones in [AGENTS.md](AGENTS.md)). Control playback with slash commands or on the website (log in with Discord). Settings are on the website, and queues survive restarts.

- [How it works](docs/how-it-works.md): a tour of the code, and how to add a command
- [Design](docs/design.md): the full design and the decisions behind it
- [AGENTS.md](AGENTS.md): instructions for AI coding agents (Claude Code reads it through `CLAUDE.md`)

## Commands

| Command | What it does |
|---|---|
| `/play <link>` | Joins your voice channel and plays the link, or adds it to the queue if something is already playing |
| `/pause` / `/resume` | Pauses or resumes the current track. After a restart, `/resume` joins your voice channel and continues the song where it stopped. |
| `/skip` | Skips to the next track |
| `/stop` | Stops playback, clears the queue and leaves the voice channel |
| `/seek <time>` | Jumps to a point in the current track, like `1:30` or `90` (seconds) |
| `/queue` | Shows the current track, what's coming up, the volume and the loop mode |
| `/remove <position>` | Removes a track from the queue (positions are the numbers in `/queue`) |
| `/move <from> <to>` | Moves a track to a different place in the queue (`to: 1` plays it next) |
| `/shuffle` | Shuffles the queue; the current track keeps playing |
| `/loop off\|track\|queue` | Repeats nothing, the current track, or the whole queue |
| `/volume [percent]` | Shows or sets the volume, 0–150% (100 is normal). Goes back to the server's starting volume when the bot leaves. |
| `/filter <effect>` | Adds an audio effect: nightcore, vaporwave, bassboost, 8d, karaoke or soft (`off` removes it). One at a time; it stays on for the next songs until changed or the bot leaves. |

The bot leaves the voice channel by itself, clearing the queue, after being alone in it for 60 seconds (changeable per server).

**Who can use what:** `/queue` is for everyone; the other commands are for DJs. Server admins (Administrator or Manage Server) and the bot owner (`OWNER_ID`) can always do everything. **Until a server admin picks a DJ role on the website's Settings tab, nobody else is a DJ.** Pick `@everyone` there to let every member control playback.

**After a restart** (including every save while `npm run dev` runs), the bot remembers each server's song, position, queue, loop mode, effect and recently played list. If people are still in its voice channel, it rejoins and carries on from where it stopped. Otherwise the song waits, paused, until someone uses `/resume` or `/play`.

Supported links: YouTube, SoundCloud, Bandcamp, Twitch, Vimeo, direct audio file URLs, and most other sites [yt-dlp supports](https://github.com/yt-dlp/yt-dlp/blob/master/supportedsites.md). Searching by song name isn't supported yet.

Links are played through Lavalink when it can. When it can't (YouTube blocks Lavalink's plugin every now and then, and SoundCloud is broken in Lavalink 4.2.2), the bot downloads the song with [yt-dlp](https://github.com/yt-dlp/yt-dlp) instead. That takes about 10 seconds, so expect a short pause on those songs.

## Setup (Windows)

### 1. Install the prerequisites

You need Node.js (LTS) and Java 17 or newer. ffmpeg isn't used yet; milestone 8 (uploaded files) needs it.

```
winget install OpenJS.NodeJS.LTS EclipseAdoptium.Temurin.21.JDK Gyan.FFmpeg
```

### 2. Install the project

```
npm install
npm run setup:lavalink
npm run setup:ytdlp
```

- `setup:lavalink` downloads `lavalink/Lavalink.jar`. Lavalink downloads its YouTube plugin by itself the first time it starts.
- `setup:ytdlp` downloads yt-dlp into `bin/`. The bot updates it on every start, because YouTube changes often break old versions. (A system-wide yt-dlp also works if `bin/` has none.)

### 3. Create the Discord application

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications) and create an application.
2. Under **Bot**, click **Reset Token** and copy the token.
3. Under **OAuth2 → URL Generator**, tick the scopes `bot` and `applications.commands`, then the permissions View Channels, Connect, Speak, Send Messages and Embed Links. Open the generated URL to invite the bot to your server.
4. For the website's "Log in with Discord": under **OAuth2**, click **Reset Secret** and copy it, and under **Redirects** add `http://localhost:3000/api/auth/callback` (with your `PUBLIC_URL` instead of `http://localhost:3000` once the site is public).

### 4. Fill in `.env`

Copy `.env.example` to `.env` if you don't have one yet, then fill in:

| Variable | Where to find it |
|---|---|
| `DISCORD_TOKEN` | The bot token from step 3 |
| `DISCORD_CLIENT_ID` | Developer Portal → your app → **General Information** → Application ID |
| `DISCORD_CLIENT_SECRET` | The secret from step 3.4 |
| `SESSION_SECRET` | A long random string that signs login cookies. Generate one with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `OWNER_ID` | Your own Discord user ID (Developer Mode on → right-click yourself → Copy User ID). You can do everything, everywhere. |
| `LAVALINK_PASSWORD` | Any long random string. The bot and Lavalink both read it from here. |
| `DEV_GUILD_ID` (optional) | Your server's ID (turn on Developer Mode in Discord, right-click the server → Copy Server ID). Slash commands then register only in that server and show up there instantly, but disappear from your other servers until you empty it again. |

`WEB_PORT`, `PUBLIC_URL` and `OAUTH_REDIRECT_URI` can stay as they are while the website runs on your own computer.

## Running

You need two terminals: one for Lavalink, one for the bot.

```
npm run lavalink
```

Wait for `Lavalink is ready to accept connections`, then:

```
npm run dev
```

`dev` restarts the bot whenever you save a file. When you see `logged in as ...` and `node "main" connected`, join a voice channel and run `/play` with a YouTube link.

### The website

While the bot runs, open **http://localhost:3000** (or whatever `WEB_PORT` is) and log in with Discord. You see the servers you share with the bot; with more than one, pick one at the top. Everything updates live as things change in Discord.

- **Everyone** sees the current song with its progress bar, the active effect, the queue, and the recently played songs.
- **DJs** also get the controls: add a link, pause/resume, skip, stop, drag the progress bar to seek, volume, loop, effects, move ↑↓ or remove queued songs, shuffle, clear the queue (the current song keeps playing), and "Play again" on recently played songs or clear that list.
- Adding a song from the website joins the voice channel you're in, like `/play`.
- **Server admins** get a **Settings** tab for that server:

  | Setting | What it does |
  |---|---|
  | DJ role | Who may control playback. No DJ role = only admins; `@everyone` = every member. |
  | Only from the bot's voice channel | DJs must be in the bot's voice channel to control it (admins don't). Off by default. |
  | Starting volume | The volume the bot joins at (default 100%). |
  | Queue limit | The most songs that can wait in the queue (default: no limit). |
  | Longest song | Longer songs can't be added; livestreams are always allowed (default: no limit). |
  | Leave an empty channel after | How long the bot stays alone in voice before leaving (default 60 s; 0 = never). |
  | Announce songs in | A text channel where the bot posts "Now playing …" for every new song (default: off). |

- **You (the bot owner)** also get an **Admin** button at the top: how YouTube links are loaded (automatic, only Lavalink's plugin, or only yt-dlp), whether yt-dlp updates on every start, an "Update now" button for yt-dlp, and the status of the bot, Lavalink and yt-dlp.

Settings apply right away; there's nothing to restart.

For now the website is only reachable from your own computer; making it public is milestone 9. With `npm run dev`, edits to `web/` show up in the browser immediately.

Other scripts:

| Script | What it does |
|---|---|
| `npm run typecheck` | Checks the TypeScript (bot and website) for errors without running anything |
| `npm run build` | Compiles the bot to `dist/` and the website to `web/dist/` |
| `npm start` | Runs the compiled build (use this instead of `dev` for day-to-day hosting; run `npm run build` first) |

## Troubleshooting

- **"npm.ps1 cannot be loaded because running scripts is disabled"** in PowerShell: Windows blocks PowerShell scripts by default. Either run `npm.cmd run ...` instead of `npm run ...`, or allow local scripts once with `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` (or use Command Prompt instead of PowerShell).
- **`Invalid .env`** when starting: the message lists which variables are missing.
- **"The audio server (Lavalink) isn't connected"**: Lavalink isn't running, or `LAVALINK_PASSWORD` / `LAVALINK_PORT` don't match. Start it with `npm run lavalink` (not `java -jar` directly), because that script passes the password from `.env`. The bot keeps retrying every 5 seconds, so there's no need to restart it.
- **New slash commands don't show up**: the Discord app caches the command list. Press **Ctrl+R** in Discord to reload it (or fully quit and reopen it). If they're still missing, check the bot's console for `registered N global commands`. Setting `DEV_GUILD_ID` makes updates instant in that one server.
- **"YouTube refused to play this video"** (the title loads, then playback fails): YouTube regularly blocks the clients Lavalink's YouTube plugin pretends to be. The bot's console shows which clients failed and why. The usual fix is a newer plugin version in `lavalink/application.yml` (see [youtube-source releases](https://github.com/lavalink-devs/youtube-source/releases)), or changing the order of `clients` there, then restarting Lavalink. The comments in that file record what was tested last.
- **"yt-dlp isn't installed"**: run `npm run setup:ytdlp`.
- **Some songs take ~10 seconds to start**: those are being downloaded with yt-dlp because Lavalink couldn't load them. The console shows `[resolver] lavalink couldn't load ...` or `[player] lavalink couldn't play ...` with the reason.
- **An error starting with "yt-dlp:"**: yt-dlp couldn't get the song either; its message usually says why (private video, region-locked, removed). If YouTube songs that should work fail this way, restart the bot so it updates yt-dlp.
- **The website doesn't load**: check the bot's console. `[web] website running at ...` means it's up; `[web] the website couldn't start` says why (often another program already uses port 3000; change `WEB_PORT` in `.env`). The Discord side keeps working either way.
- **"The website hasn't been built yet"** with `npm start`: run `npm run build` first.
- **Discord says "Invalid OAuth2 redirect_uri"** when logging in: add `http://localhost:3000/api/auth/callback` (exactly, matching `OAUTH_REDIRECT_URI`) under OAuth2 → Redirects in the Developer Portal.
- **"Discord didn't accept the login"**: `DISCORD_CLIENT_SECRET` is wrong or was reset; copy the current one from the Developer Portal.
- **A role change doesn't apply on the website right away**: the website rechecks your roles at most every 30 seconds. (Changing which role is the DJ role applies at once.)
- **Friends get "You need to be a DJ"**: the server has no DJ role yet, so only admins can control playback. A server admin opens the website → the server → **Settings** → DJ role, and picks a role (or `@everyone`).
- **"Join the bot's voice channel (…) to control playback"**: the server's "Only from the bot's voice channel" setting is on. Join that channel, or ask an admin to turn the setting off.
- **"Playback stopped when the bot restarted"**: the bot restarted while nobody was in its voice channel (or the song was paused). Use `/resume` (or Resume on the website) from a voice channel to carry on.
- **Start completely fresh** (forget all settings, queues and history): stop the bot and delete `data/bot.db` (and `bot.db-wal` / `bot.db-shm` next to it, if present). It's recreated on the next start.
- Lavalink's own logs are in `lavalink/logs/`. Downloaded songs are kept in `data/ytdlp-cache/` (the 20 most recent) and deleted when the bot starts.

## Project layout

```
src/
  index.ts              Starts everything: config → database → Lavalink → Discord bot → website
  config.ts             Reads and checks .env
  permissions.ts        Who may do what (owner, admin, DJ, member), for commands and the website
  db/
    database.ts         Opens data/bot.db (SQLite)
    migrations.ts       Creates and updates the tables
    settingsStore.ts    Global and per-server settings
    playerStateStore.ts Each server's saved song, position, queue and history
  bot/
    client.ts           The discord.js client
    commands/           One file per slash command
    events/             Discord event handlers (ready + rejoining after a restart, slash commands, playback messages)
    voice.ts            Counts the people in a voice channel
    format.ts           Formatting helpers for Discord messages
  player/
    PlayerManager.ts    The one entry point for playback; commands call this
    GuildPlayer.ts      One server's current track and queue
    lavalink.ts         Connection to the Lavalink server
    resolvers/          Turns a link into a track Lavalink can play (through Lavalink, or a yt-dlp download)
    filters.ts          Applies the audio effects (the list itself is in src/shared/filters.ts)
    errors.ts           UserError: errors whose message is shown to users
  web/
    server.ts           Starts the website: REST API, Socket.IO and the React app on one port
    routes/             REST API routes (under /api): auth.ts (login), guilds.ts (read), player.ts (controls),
                        settings.ts (a server's settings), admin.ts (the owner's Admin page)
    session.ts          The signed login cookie
    access.ts           requireGuildAccess(): the permission check every server route starts with
    http.ts             route(): turns errors into HTTP answers
    socket.ts           Pushes PlayerManager's events to browsers
    frontend.ts         Serves the React app (Vite in development, web/dist in production)
  shared/               Types and helpers used by both the bot and the website
web/                    The React website (Vite)
  src/App.tsx           The page: login, server picker, the server's player and Settings tab, the Admin page
  src/components/       AddSong, NowPlaying (+ SeekBar, PlayerControls), EffectPicker, QueueList, HistoryList,
                        GuildSettingsForm, AdminPanel
  src/api.ts            One function per REST call
  src/useGuildState.ts  Live state from the bot over Socket.IO
lavalink/
  application.yml       Lavalink settings (sources, YouTube plugin)
scripts/                Helpers for downloading Lavalink and yt-dlp, and starting Lavalink
bin/                    yt-dlp (downloaded, not in git)
data/bot.db             Settings, queues and history (SQLite, not in git)
data/ytdlp-cache/       Songs downloaded by yt-dlp (not in git)
docs/                   Longer explanations
```
