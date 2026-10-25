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

The rule that holds it together: **commands (and later the website) only call `PlayerManager` methods.** If Discord and the website both go through the same methods, they can never show different queues.

## What happens on `/play <link>`

1. **`events/interactionCreate.ts`** receives the command, looks it up in `commands/index.ts` and calls `play.execute()`. It also catches errors (see [Errors](#errors)).
2. **`commands/play.ts`** calls `deferReply()` first, because Discord wants a response within 3 seconds and loading a link can take longer. Then it calls `players.play(guildId, { input, requestedBy, voiceChannelId, textChannelId })`.
3. **`PlayerManager.play()`**:
   1. `parseInput()` checks that the input is a link and labels it `youtube` or `url`.
   2. `GuildPlayer.ensureConnected()` joins the requester's voice channel, unless the bot is already in one.
   3. `fetchMetadata()` loads the link through Lavalink to get the title, duration and thumbnail.
   4. `GuildPlayer.enqueue()` either plays it right away (if nothing was playing) or adds it to the end of the queue.
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

Tracks that played to the end or were skipped go into `GuildPlayer.history` (newest first, the last 20; a track on repeat is listed once). Tracks that failed don't. The website shows it as "Recently played". It survives `/stop`, but not a bot restart until milestone 6 saves it.

## Lavalink first, yt-dlp as the backup

There are two ways to turn a link into something Lavalink can play (`src/player/resolvers/`):

- **`lavalink`**: Lavalink loads the link itself (`resolvers/lavalink.ts`). Fast, and the normal path.
- **`ytdlp`**: yt-dlp downloads the audio into `data/ytdlp-cache/`, and Lavalink plays the file from disk (`resolvers/ytdlp.ts`). Slower (about 10 seconds per song), but yt-dlp keeps up with YouTube's changes faster than Lavalink's plugin, and it supports SoundCloud, which Lavalink 4.2.2 can't play.

`methodsFor(source)` in `resolvers/index.ts` decides which methods to try, in order. For YouTube that depends on `YOUTUBE_MODE` (`auto` = Lavalink then yt-dlp); every other site gets Lavalink then yt-dlp. `resolvePlayable()` tries them until one works.

Why download instead of handing Lavalink yt-dlp's audio URL (`yt-dlp -g`)? Tested 2026-10-25: YouTube answers those URLs with 403 Forbidden unless the request comes from yt-dlp itself.

A link can also *load* fine through Lavalink and then fail while *playing* (YouTube blocking the plugin did exactly this). Then:

1. Lavalink reports a track error. `GuildPlayer.onTrackError()` sees that the track came from `lavalink` and that `ytdlp` is still left to try, so it records a `pendingRetry` (including how far playback got) and tells `PlayerManager` not to show the error.
2. Lavalink then ends the track with reason `loadFailed`. `onTrackEnded()` finds the pending retry and plays the same item again with yt-dlp, from the same position.
3. If yt-dlp fails too, that error *is* shown, and the queue moves on.

Downloads are shared and cached by URL (the last 20 songs), so looping a song doesn't download it again. The cache is emptied on every start, and the bot runs `yt-dlp -U` at startup to stay current.

### Why load the link again right before playing?

The queue stores what the user typed (the link), not a ready-to-play track. Some playable URLs expire: Discord attachment links after about a day, and the direct audio URLs yt-dlp produces after a few hours. Loading at play time means a song that waited in the queue for a long time still works. This becomes important in milestones 3 (yt-dlp) and 7 (uploaded files).

### Why does GuildPlayer keep its own queue?

`lavalink-client` has a queue built in, but it stores resolved tracks, which is exactly what the previous section avoids. So the bot keeps its own queue and turns the library's automatic skipping off (`autoSkip: false` in `player/lavalink.ts`). A side effect: because the library's queue is always empty, it reports every track end as `queueEnd` instead of `trackEnd`. That's why `PlayerManager` listens to `queueEnd`.

### Queue positions and item ids

Users see queue positions: the numbers in `/queue`, where 1 is the next track. `PlayerManager` identifies items by their `id` instead (`remove(guildId, itemId)`, `move(guildId, itemId, toPosition)`), because a position can change between the moment someone reads the queue and the moment they act on it. The website will send ids. Slash commands translate a position into an id with `itemAtPosition()` in `src/bot/commands/positions.ts`.

### Leaving an empty channel

`bot/events/voiceStateUpdate.ts` watches people joining and leaving voice channels. Whenever the bot's channel changes, it counts the people in it (bots don't count) and calls `players.updateListenerCount()`. When the count hits 0, `PlayerManager` starts a 60-second timer (`LEAVE_WHEN_EMPTY_AFTER_MS`). If someone joins in time, the timer is cancelled; otherwise the bot does a normal `/stop`. In milestone 6 the delay becomes the per-server `leaveWhenEmptyAfterSec` setting.

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
| REST API | `src/web/routes/` | `auth.ts` (login), `guilds.ts` (your servers, a server's state), `player.ts` (the controls) |
| Socket.IO | `src/web/socket.ts` | Pushes every change to the browsers watching that server |
| The React app | `src/web/frontend.ts` | Serves `web/`: through Vite when running from source (`npm run dev`, instant reloads), or the built `web/dist/` with `npm start` |

How the page stays live:

1. The browser opens a Socket.IO connection and sends `guild:watch` with the server's id (`web/src/useGuildState.ts`).
2. `socket.ts` checks that the logged-in user is a member of that server, puts the connection in the room `guild:<id>`, and answers with `state`, a full `PlayerSnapshot`.
3. From then on, every `PlayerManager` event for that server is forwarded to the room: `queue:update` (with a full snapshot) whenever the current track or the queue changes, and `player:update` (position, paused, volume, loop mode, filter) whenever those change and about once a second while playing.
4. Between updates, `NowPlaying` keeps the progress bar moving by counting up from the last position.

The message types are defined once in `src/shared/types.ts` (`ServerToClientEvents`, `ClientToServerEvents`), and both sides import them, so the TypeScript compiler catches it if the bot and the website disagree. The website imports shared code through `web/src/shared.ts`.

Changes from the website go through REST routes (`src/web/routes/player.ts`), never the socket, so permissions are checked in one place. Buttons call the functions in `web/src/api.ts`. The page doesn't apply a change itself: it waits for the socket's update, exactly as if someone had used the slash command in Discord, so the two can't disagree.

`src/web/http.ts` has `route()`, a wrapper for async route handlers: an `HttpError` becomes its status (401, 403, 404…), a `UserError` becomes 400 with its message, anything else a 500 with the details logged to the console.

The server still listens on `127.0.0.1` only. Making it public is milestone 9; logins and permissions are already in place for that.

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
| admin | Administrator or Manage Server | settings (milestone 6) and all controls |
| dj | the DJ role (milestone 6); **for now every member** | control playback |
| member | anyone in the server | look |

- **Slash commands** declare a `permission` (`src/bot/commands/*.ts`), checked in `bot/events/interactionCreate.ts` using the member Discord sends with the command.
- **Web routes** start with `requireGuildAccess(req, client, level)` (`src/web/access.ts`). It answers 401 if nobody is logged in, 404 if the user (or the bot) isn't in that server, and 403 if their level is too low. It looks the member up through Discord's API (no privileged intent needed), cached for 30 seconds, so a role change takes up to 30 s to apply on the website.
- **The socket** only lets a browser watch a server whose member is logged in.
- **The website** shows controls only to DJs (`hasLevel(guild.level, "dj")`), but that's just convenience: every change is checked again on the server.
- Changes must be JSON (`requireJsonForChanges`), and the cookie is `sameSite=lax`. Together these stop another website from making changes through your logged-in browser.

**To show something new on the page:** if the information is already in `PlayerSnapshot`, just use it in a component in `web/src/components/`. If not, add it to `PlayerSnapshot` in `src/shared/types.ts`, fill it in `GuildPlayer.snapshot()` (and `PlayerManager.getState()` for servers with no player yet), and the compiler will point at anything else that needs updating.

## Errors

- Throw **`UserError`** (from `src/player/errors.ts`) when the message is meant for the user, e.g. `throw new UserError("Join a voice channel first.")`. The command handler shows that message as the reply.
- Any other error is a bug or an unexpected failure: it is logged to the console, and the user sees "Something went wrong".
- Errors that happen later, after the command already replied (for example a queued track failing to load), are emitted as `error` events by `PlayerManager`. `bot/events/playerEvents.ts` posts them in the channel where `/play` was used.

## How to add a slash command

Example: a `/clear` command that empties the queue but keeps the current track playing.

**1. Add the logic to `GuildPlayer`** (`src/player/GuildPlayer.ts`):

```ts
/** Removes everything from the queue. The current track keeps playing. Returns how many items were removed. */
clear(): number {
  const removed = this.queue.length;
  this.queue = [];
  this.emitQueueUpdate();
  return removed;
}
```

**2. Expose it on `PlayerManager`** (`src/player/PlayerManager.ts`), going through `run()`:

```ts
async clear(guildId: string): Promise<number> {
  const player = this.players.get(guildId);
  if (!player) return 0;
  return player.run(async () => player.clear());
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
    const removed = await players.clear(interaction.guildId);
    await interaction.reply(removed > 0 ? `Removed ${removed} tracks from the queue.` : "The queue is already empty.");
  },
};
```

**4. Register it** in `src/bot/commands/index.ts` by adding `clear` to the `commands` array.

Restart the bot (`npm run dev` does this on save). Commands are registered with Discord on every start, so `/clear` appears without any extra step (instantly if `DEV_GUILD_ID` is set).

Things to keep in mind:
- If the command might take more than a couple of seconds (anything that loads a link), call `await interaction.deferReply()` first and answer with `editReply` instead of `reply`.
- Command names must be lowercase, with no spaces.
- Keep Discord-specific code (replies, embeds) in the command and playback logic in `GuildPlayer`/`PlayerManager`, so the website can reuse the same methods.
- To offer it on the website too, add a route in `src/web/routes/player.ts` (one `djRoute(...)` line calling the same `PlayerManager` method), a function in `web/src/api.ts`, and a button in a component.

## Configuration files

- **`.env`**: secrets and connection settings. Read and checked in `src/config.ts`; add new variables to the zod schema there and to `.env.example`.
- **`lavalink/application.yml`**: which sources Lavalink may use, plus the YouTube plugin's version and settings. Restart Lavalink after changing it. The password isn't in this file: `scripts/lavalink.mjs` passes it from `.env` when Lavalink starts.
