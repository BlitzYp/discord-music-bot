# Discord Music Bot

A self-hosted Discord bot that plays music in voice channels. Audio is played by [Lavalink](https://lavalink.dev), a separate Java server that runs next to the bot on the same machine.

**Status:** milestone 4 of 8 (see the milestones in [AGENTS.md](AGENTS.md)). Control playback with slash commands; the website shows what's playing, live.

- [How it works](docs/how-it-works.md): a tour of the code, and how to add a command
- [Design](docs/design.md): the full design and the decisions behind it
- [AGENTS.md](AGENTS.md): instructions for AI coding agents (Claude Code reads it through `CLAUDE.md`)

## Commands

| Command | What it does |
|---|---|
| `/play <link>` | Joins your voice channel and plays the link, or adds it to the queue if something is already playing |
| `/pause` / `/resume` | Pauses or resumes the current track |
| `/skip` | Skips to the next track |
| `/stop` | Stops playback, clears the queue and leaves the voice channel |
| `/queue` | Shows the current track, what's coming up, the volume and the loop mode |
| `/remove <position>` | Removes a track from the queue (positions are the numbers in `/queue`) |
| `/move <from> <to>` | Moves a track to a different place in the queue (`to: 1` plays it next) |
| `/shuffle` | Shuffles the queue; the current track keeps playing |
| `/loop off\|track\|queue` | Repeats nothing, the current track, or the whole queue |
| `/volume [percent]` | Shows or sets the volume, 0–150% (100 is normal). Resets to 100% when the bot leaves. |
| `/filter <effect>` | Adds an audio effect: nightcore, vaporwave, bassboost, 8d, karaoke or soft (`off` removes it). One at a time; it stays on for the next songs until changed or the bot leaves. |

The bot leaves the voice channel by itself, clearing the queue, after being alone in it for 60 seconds.

Supported links: YouTube, SoundCloud, Bandcamp, Twitch, Vimeo, direct audio file URLs, and most other sites [yt-dlp supports](https://github.com/yt-dlp/yt-dlp/blob/master/supportedsites.md). Searching by song name isn't supported yet.

Links are played through Lavalink when it can. When it can't (YouTube blocks Lavalink's plugin every now and then, and SoundCloud is broken in Lavalink 4.2.2), the bot downloads the song with [yt-dlp](https://github.com/yt-dlp/yt-dlp) instead. That takes about 10 seconds, so expect a short pause on those songs.

## Setup (Windows)

### 1. Install the prerequisites

You need Node.js (LTS) and Java 17 or newer. ffmpeg isn't used yet; milestone 7 (uploaded files) needs it.

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

### 4. Fill in `.env`

Copy `.env.example` to `.env` if you don't have one yet, then fill in:

| Variable | Where to find it |
|---|---|
| `DISCORD_TOKEN` | The bot token from step 3 |
| `DISCORD_CLIENT_ID` | Developer Portal → your app → **General Information** → Application ID |
| `LAVALINK_PASSWORD` | Any long random string. The bot and Lavalink both read it from here. |
| `DEV_GUILD_ID` (optional) | Your server's ID (turn on Developer Mode in Discord, right-click the server → Copy Server ID). Slash commands then register only in that server and show up there instantly, but disappear from your other servers until you empty it again. |

The other variables are for the website and can stay empty for now.

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

While the bot runs, open **http://localhost:3000** (or whatever `WEB_PORT` is). It shows the current song, a progress bar, and the queue, and updates live as things change in Discord. With more than one server, pick one at the top.

For now it's read-only and only reachable from your own computer, because there's no login yet (milestone 5). With `npm run dev`, edits to `web/` show up in the browser immediately.

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
- Lavalink's own logs are in `lavalink/logs/`. Downloaded songs are kept in `data/ytdlp-cache/` (the 20 most recent) and deleted when the bot starts.

## Project layout

```
src/
  index.ts              Starts everything: config → Lavalink → Discord bot → website
  config.ts             Reads and checks .env
  bot/
    client.ts           The discord.js client
    commands/           One file per slash command
    events/             Discord event handlers (ready, slash commands, playback errors)
    format.ts           Formatting helpers for Discord messages
  player/
    PlayerManager.ts    The one entry point for playback; commands call this
    GuildPlayer.ts      One server's current track and queue
    lavalink.ts         Connection to the Lavalink server
    resolvers/          Turns a link into a track Lavalink can play (through Lavalink, or a yt-dlp download)
    filters.ts          Audio effects for /filter
    errors.ts           UserError: errors whose message is shown to users
  web/
    server.ts           Starts the website: REST API, Socket.IO and the React app on one port
    routes/             REST API routes (under /api)
    socket.ts           Pushes PlayerManager's events to browsers
    frontend.ts         Serves the React app (Vite in development, web/dist in production)
  shared/               Types and helpers used by both the bot and the website
web/                    The React website (Vite)
  src/App.tsx           The page: server picker, now playing, queue
  src/components/       NowPlaying, QueueList, GuildPicker
  src/useGuildState.ts  Live state from the bot over Socket.IO
lavalink/
  application.yml       Lavalink settings (sources, YouTube plugin)
scripts/                Helpers for downloading Lavalink and yt-dlp, and starting Lavalink
bin/                    yt-dlp (downloaded, not in git)
data/ytdlp-cache/       Songs downloaded by yt-dlp (not in git)
docs/                   Longer explanations
```
