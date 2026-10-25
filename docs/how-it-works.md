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

`/filter` effects are built into Lavalink; the bot only picks settings. `src/player/filters.ts` maps each name to `lavalink-client` helpers (nightcore and vaporwave change speed and pitch, bassboost is an equalizer preset, 8d is rotation, and so on). `applyFilter()` first resets everything, so exactly one effect is ever active. Lavalink keeps filters on the player, so they carry over to the next songs; a new player (after the bot leaves voice) starts without effects, which is why `GuildPlayer.reset()` sets `filter` back to `off`.

To add an effect: add its name to `AUDIO_FILTERS` in `src/shared/types.ts`, then add a description and a `case` in `src/player/filters.ts`. The command's choices are built from that list.

### `run()`: one change at a time

Every change to a `GuildPlayer` goes through `player.run(() => ...)`. That waits for the previous change in that server to finish before starting the next one. Without it, a `/skip` arriving at the same moment a track ends by itself could advance the queue twice.

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
- Keep Discord-specific code (replies, embeds) in the command and playback logic in `GuildPlayer`/`PlayerManager`, so the website can reuse the same methods later.

## Configuration files

- **`.env`**: secrets and connection settings. Read and checked in `src/config.ts`; add new variables to the zod schema there and to `.env.example`.
- **`lavalink/application.yml`**: which sources Lavalink may use, plus the YouTube plugin's version and settings. Restart Lavalink after changing it. The password isn't in this file: `scripts/lavalink.mjs` passes it from `.env` when Lavalink starts.
