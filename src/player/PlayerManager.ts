import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import type { LavalinkManager } from "lavalink-client";
import type { PlayerSnapshot, QueueItem, Requester } from "../shared/types.js";
import { GuildPlayer } from "./GuildPlayer.js";
import { fetchMetadata, parseInput } from "./resolvers/index.js";

/**
 * Events PlayerManager emits whenever something changes. Today the bot listens to "error";
 * the website will forward all of them to the browser over Socket.IO.
 */
export interface PlayerManagerEvents {
  "queue:update": [guildId: string, state: PlayerSnapshot];
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

  /** What's playing and queued in a server right now. */
  getState(guildId: string): PlayerSnapshot {
    const player = this.players.get(guildId);
    if (player) return player.snapshot();
    return { guildId, voiceChannelId: null, current: null, positionMs: 0, paused: false, queue: [] };
  }

  private getOrCreatePlayer(guildId: string): GuildPlayer {
    let player = this.players.get(guildId);
    if (!player) {
      player = new GuildPlayer(guildId, this);
      this.players.set(guildId, player);
    }
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

    this.lavalink.on("trackStuck", (lavalinkPlayer) => {
      this.players.get(lavalinkPlayer.guildId)?.onTrackStuck();
    });

    // Lavalink couldn't play the track. It follows up with a "loadFailed" track end, which moves the queue on;
    // here we only report the reason.
    this.lavalink.on("trackError", (lavalinkPlayer, track, payload) => {
      const guildId = lavalinkPlayer.guildId;
      const item = this.players.get(guildId)?.current ?? null;
      const reason = "exception" in payload ? payload.exception?.message : undefined;
      this.emit("error", guildId, item, new Error(reason ?? `Track failed: ${track?.info.title ?? "unknown"}`));
    });

    // The Lavalink player is gone (e.g. someone disconnected the bot from voice), so its queue is too.
    this.lavalink.on("playerDestroy", (lavalinkPlayer) => {
      this.players.get(lavalinkPlayer.guildId)?.reset();
    });
  }
}
