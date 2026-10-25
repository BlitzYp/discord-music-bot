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

- `finished` or `loadFailed`: play the next item in the queue.
- `stopped`, `replaced` or `cleanup`: the bot caused it itself (`/stop`, `/skip` and so on), so do nothing.

`playNext()` takes the next item off the queue and **loads its link again** right before playing it (see below). If that fails, it reports the error in the channel and tries the item after it. When the queue is empty the bot goes quiet but stays in the voice channel.

### Why load the link again right before playing?

The queue stores what the user typed (the link), not a ready-to-play track. Some playable URLs expire: Discord attachment links after about a day, and the direct audio URLs yt-dlp produces after a few hours. Loading at play time means a song that waited in the queue for a long time still works. This becomes important in milestones 3 (yt-dlp) and 7 (uploaded files).

### Why does GuildPlayer keep its own queue?

`lavalink-client` has a queue built in, but it stores resolved tracks, which is exactly what the previous section avoids. So the bot keeps its own queue and turns the library's automatic skipping off (`autoSkip: false` in `player/lavalink.ts`). A side effect: because the library's queue is always empty, it reports every track end as `queueEnd` instead of `trackEnd`. That's why `PlayerManager` listens to `queueEnd`.

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
