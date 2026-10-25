import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import type { LavalinkManager } from "lavalink-client";
import type { AudioFilter, LoopMode, PlayerSnapshot, QueueItem, Requester } from "../shared/types.js";
import { UserError } from "./errors.js";
import { GuildPlayer } from "./GuildPlayer.js";
import { fetchMetadata, parseInput } from "./resolvers/index.js";

/** How long the bot stays in a voice channel with no listeners before leaving. Becomes `leaveWhenEmptyAfterSec` in milestone 6. */
const LEAVE_WHEN_EMPTY_AFTER_MS = 60_000;

/**
 * Events PlayerManager emits whenever something changes. The bot posts "error" in Discord;
 * src/web/socket.ts forwards all of them to the browser over Socket.IO.
 */
export interface PlayerManagerEvents {
  /** The current track or the queue changed. */
  "queue:update": [guildId: string, state: PlayerSnapshot];
  /** Paused/resumed, volume, loop mode or filter changed; also sent about once a second while playing. */
  "player:update": [guildId: string, state: PlayerSnapshot];
  "track:start": [guildId: string, item: QueueItem];
  "track:end": [guildId: string, item: QueueItem, reason: string];
  error: [guildId: string, item: QueueItem | null, error: unknown];
}

export interface PlayRequest {
  /** What the user typed: for now, a link. */
  input: string;
  requestedBy: Requester;
  /** The voice channel the requester is in. Used to join voice if the bot isn't connected yet. */
  voiceChannelId: string | null;
  /** Where the request came from. Used to report errors for this player later. */
  textChannelId: string | null;
}

/**
 * The one place that controls playback, for every server.
 *
 * Slash commands (and later the website's routes) should only call these methods and format the result.
 * That way Discord and the website can never disagree about what's playing.
 */
export class PlayerManager extends EventEmitter<PlayerManagerEvents> {
  /** One GuildPlayer per server, created the first time someone plays something there. */
  private readonly players = new Map<string, GuildPlayer>();
  /** Servers where the bot is alone in voice, and the timer that will make it leave. */
  private readonly leaveTimers = new Map<string, NodeJS.Timeout>();

  constructor(readonly lavalink: LavalinkManager) {
    super();
    this.listenToLavalink();
  }

  /**
   * Adds a link to the server's queue, joining the requester's voice channel first if needed.
   * Returns the new item and its position (0 = playing now).
   */
  async play(guildId: string, request: PlayRequest): Promise<{ item: QueueItem; position: number }> {
    const source = parseInput(request.input);
    const player = this.getOrCreatePlayer(guildId);

    // Join voice before loading the link, so "join a voice channel first" comes back immediately.
    await player.run(() => player.ensureConnected(request.voiceChannelId, request.textChannelId));

    const { meta, track } = await fetchMetadata(this.lavalink, source, request.requestedBy);
    const item: QueueItem = { id: randomUUID(), source, ...meta, requestedBy: request.requestedBy };

    const { position } = await player.run(() => player.enqueue(item, track));
    return { item, position };
  }

  /** Skips the current track. Returns the skipped item, or null if nothing was playing. */
  async skip(guildId: string): Promise<QueueItem | null> {
    const player = this.players.get(guildId);
    if (!player) return null;
    return player.run(() => player.skip());
  }

  /** Stops playback, clears the queue and leaves voice. Returns false if there was nothing to stop. */
  async stop(guildId: string): Promise<boolean> {
    const player = this.players.get(guildId);
    const isActive = player && (player.current || player.voiceChannelId);
    if (!isActive) return false;

    await player.run(() => player.stop());
    return true;
  }

  async pause(guildId: string): Promise<void> {
    const player = this.requirePlayer(guildId);
    await player.run(() => player.pause());
  }

  async resume(guildId: string): Promise<void> {
    const player = this.requirePlayer(guildId);
    await player.run(() => player.resume());
  }

  async setVolume(guildId: string, volume: number): Promise<void> {
    const player = this.requirePlayer(guildId);
    await player.run(() => player.setVolume(volume));
  }

  async setLoopMode(guildId: string, mode: LoopMode): Promise<void> {
    const player = this.requirePlayer(guildId);
    await player.run(async () => player.setLoopMode(mode));
  }

  async setFilter(guildId: string, filter: AudioFilter): Promise<void> {
    const player = this.requirePlayer(guildId);
    await player.run(() => player.setFilter(filter));
  }

  /** Removes a queued item by its id. Returns the removed item. */
  async remove(guildId: string, itemId: string): Promise<QueueItem> {
    const player = this.requirePlayer(guildId);
    return player.run(async () => player.remove(itemId));
  }

  /** Moves a queued item to a new position (1 = next). Returns the moved item. */
  async move(guildId: string, itemId: string, toPosition: number): Promise<QueueItem> {
    const player = this.requirePlayer(guildId);
    return player.run(async () => player.move(itemId, toPosition));
  }

  async shuffle(guildId: string): Promise<void> {
    const player = this.requirePlayer(guildId);
    await player.run(async () => player.shuffle());
  }

  /** What's playing and queued in a server right now. */
  getState(guildId: string): PlayerSnapshot {
    const player = this.players.get(guildId);
    if (player) return player.snapshot();
    return {
      guildId,
      voiceChannelId: null,
      current: null,
      positionMs: 0,
      paused: false,
      volume: 100,
      loopMode: "off",
      filter: "off",
      queue: [],
    };
  }

  /**
   * Tells the manager how many people (not counting bots) are in the bot's voice channel.
   * The bot calls this whenever someone joins, leaves or moves. With nobody left, the bot waits
   * LEAVE_WHEN_EMPTY_AFTER_MS and then stops and leaves, unless someone comes back first.
   */
  updateListenerCount(guildId: string, listeners: number): void {
    const pendingLeave = this.leaveTimers.get(guildId);

    if (listeners > 0) {
      if (pendingLeave) this.cancelLeaveTimer(guildId);
      return;
    }

    const isInVoice = this.players.get(guildId)?.voiceChannelId;
    if (pendingLeave || !isInVoice) return;

    const timer = setTimeout(() => {
      this.leaveTimers.delete(guildId);
      this.stop(guildId).catch((error) => this.emit("error", guildId, null, error));
    }, LEAVE_WHEN_EMPTY_AFTER_MS);
    this.leaveTimers.set(guildId, timer);
  }

  private cancelLeaveTimer(guildId: string): void {
    clearTimeout(this.leaveTimers.get(guildId));
    this.leaveTimers.delete(guildId);
  }

  private getOrCreatePlayer(guildId: string): GuildPlayer {
    let player = this.players.get(guildId);
    if (!player) {
      player = new GuildPlayer(guildId, this);
      this.players.set(guildId, player);
    }
    return player;
  }

  /** The server's player, for actions that only make sense once the bot has played something there. */
  private requirePlayer(guildId: string): GuildPlayer {
    const player = this.players.get(guildId);
    if (!player) throw new UserError("Nothing is playing.");
    return player;
  }

  /** Passes Lavalink's playback events on to the right GuildPlayer. */
  private listenToLavalink(): void {
    this.lavalink.on("trackStart", (lavalinkPlayer) => {
      const item = this.players.get(lavalinkPlayer.guildId)?.current;
      if (item) this.emit("track:start", lavalinkPlayer.guildId, item);
    });

    // A track ended. lavalink-client reports this as "queueEnd" rather than "trackEnd", because we never put
    // anything in its own queue (see GuildPlayer). The payload's `reason` says why the track ended.
    this.lavalink.on("queueEnd", (lavalinkPlayer, _track, payload) => {
      if (payload.type !== "TrackEndEvent") return;
      const guildId = lavalinkPlayer.guildId;
      const player = this.players.get(guildId);
      if (!player) return;

      player.run(() => player.onTrackEnded(payload.reason)).catch((error) => this.emit("error", guildId, null, error));
    });

    // Lavalink reports the playback position about once a second (`playerUpdateInterval` in application.yml).
    // Passing it on keeps the website's progress bar in sync.
    this.lavalink.on("playerUpdate", (_oldState, lavalinkPlayer) => {
      const player = this.players.get(lavalinkPlayer.guildId);
      if (player?.current) this.emit("player:update", lavalinkPlayer.guildId, player.snapshot());
    });

    this.lavalink.on("trackStuck", (lavalinkPlayer) => {
      this.players.get(lavalinkPlayer.guildId)?.onTrackStuck();
    });

    // Lavalink couldn't play the track. It follows up with a "loadFailed" track end, which either retries with
    // yt-dlp or moves the queue on (see GuildPlayer.onTrackError). Here we only report the reason, and only
    // when no retry is coming.
    this.lavalink.on("trackError", (lavalinkPlayer, track, payload) => {
      const guildId = lavalinkPlayer.guildId;
      const player = this.players.get(guildId);
      const shouldReport = player ? player.onTrackError() : true;
      if (!shouldReport) return;

      const reason = "exception" in payload ? payload.exception?.message : undefined;
      const error = new Error(reason ?? `Track failed: ${track?.info.title ?? "unknown"}`);
      this.emit("error", guildId, player?.current ?? null, error);
    });

    // The Lavalink player is gone (/stop, the bot left an empty channel, or someone disconnected it),
    // so its queue is too.
    this.lavalink.on("playerDestroy", (lavalinkPlayer) => {
      this.cancelLeaveTimer(lavalinkPlayer.guildId);
      this.players.get(lavalinkPlayer.guildId)?.reset();
    });
  }
}
