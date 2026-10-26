import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import type { LavalinkManager } from "lavalink-client";
import type { LibraryStore } from "../db/libraryStore.js";
import type { PlayerStateStore, SavedPlayer, SavedStatus } from "../db/playerStateStore.js";
import type { SettingsStore } from "../db/settingsStore.js";
import { libraryFilePath } from "../library/paths.js";
import { formatDuration } from "../shared/format.js";
import { type AddManyResult, MAX_PLAYLIST_SONGS, type PlaylistPlayMode } from "../shared/playlists.js";
import type { AudioFilter, LoopMode, PlayerSnapshot, QueueItem, QueuePlacement, Requester } from "../shared/types.js";
import { UserError } from "./errors.js";
import { GuildPlayer } from "./GuildPlayer.js";
import { findSong, listPlaylist, type TrackMetadata } from "./resolvers/index.js";

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
  /** What the user typed: a link, or words to search YouTube for. */
  input: string;
  requestedBy: Requester;
  /** The voice channel the requester is in. Used to join voice if the bot isn't connected yet. */
  voiceChannelId: string | null;
  /** Where the request came from. Used to report errors for this player later. */
  textChannelId: string | null;
  /** Where the new songs go; at the end of the queue unless said otherwise. */
  placement?: QueuePlacement;
}

/**
 * Where the person asking is: their voice channel (to join it) and the text channel (for errors later), plus where
 * new songs go in the queue (used when queueing a single item; addMany takes its own mode).
 */
export type VoiceRequest = Pick<PlayRequest, "voiceChannelId" | "textChannelId" | "placement">;

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
  /** Turned off while shutting down, so leaving voice doesn't save every server as "nothing playing". */
  private saving = true;

  /**
   * Loads what every server was playing before the bot stopped, straight away: a command that arrives early
   * then continues the saved queue instead of starting a new one. Rejoining voice happens later, in
   * `rejoinAfterRestart()`, once Discord and Lavalink are connected.
   */
  constructor(
    readonly lavalink: LavalinkManager,
    readonly settings: SettingsStore,
    private readonly store: PlayerStateStore,
    /** Where library files are, so queued files can be found when they play. */
    private readonly library: LibraryStore,
  ) {
    super();
    for (const saved of store.loadAll()) this.getOrCreatePlayer(saved.guildId).restore(saved);
    this.listenToLavalink();
  }

  /**
   * Adds a link, or the best YouTube match for a search, to the server's queue, joining the requester's voice
   * channel first if needed. Returns the new item and its position (0 = playing now).
   */
  async play(guildId: string, request: PlayRequest): Promise<{ item: QueueItem; position: number }> {
    const player = this.getOrCreatePlayer(guildId);

    // Join voice before loading the link, so "join a voice channel first" comes back immediately.
    // After a restart this also continues the interrupted track.
    await player.run(() => player.ensureConnected(request.voiceChannelId, request.textChannelId));

    const youtubeMode = this.settings.global().youtubeMode;
    const { source, meta, track } = await findSong(this.lavalink, request.input, request.requestedBy, youtubeMode);
    this.checkDurationLimit(guildId, meta);
    const item: QueueItem = { id: randomUUID(), source, ...meta, requestedBy: request.requestedBy };

    const { position } = await player.run(() => player.enqueue(item, track, request.placement));
    return { item, position };
  }

  /**
   * Adds an item that's already complete (title, length and so on known, e.g. a library file) to the server's
   * queue, joining the requester's voice channel first if needed. Returns its position (0 = playing now).
   */
  async playItem(guildId: string, item: QueueItem, request: VoiceRequest): Promise<{ position: number }> {
    this.checkDurationLimit(guildId, item);
    const player = this.getOrCreatePlayer(guildId);
    await player.run(() => player.ensureConnected(request.voiceChannelId, request.textChannelId));
    return player.run(() => player.enqueue(item, /* loadedTrack */ undefined, request.placement));
  }

  /**
   * Joins the requester's voice channel, unless the bot is already in one. For work that takes a while before
   * anything is queued (saving a Discord attachment to the library), so "join a voice channel first" comes first.
   */
  async join(guildId: string, request: VoiceRequest): Promise<void> {
    const player = this.getOrCreatePlayer(guildId);
    await player.run(() => player.ensureConnected(request.voiceChannelId, request.textChannelId));
  }

  /**
   * Adds every song of a playlist link (a YouTube playlist or a video opened from one, or a Spotify album or
   * playlist) to the end of the queue, joining the requester's voice channel first if needed. Returns the
   * playlist's title, what was added, and notes such as songs that weren't found on YouTube.
   */
  async playPlaylistLink(
    guildId: string,
    request: PlayRequest,
  ): Promise<{ title: string; result: AddManyResult; notes: string[] }> {
    const player = this.getOrCreatePlayer(guildId);
    // Join voice before reading the playlist, so "join a voice channel first" comes back immediately.
    await player.run(() => player.ensureConnected(request.voiceChannelId, request.textChannelId));

    const search = { lavalink: this.lavalink, requester: request.requestedBy, youtubeMode: this.settings.global().youtubeMode };
    const { title, entries, notes } = await listPlaylist(request.input, MAX_PLAYLIST_SONGS, search);
    const items = entries.map(({ source, meta }) => ({ id: randomUUID(), source, ...meta, requestedBy: request.requestedBy }));
    const result = await this.addMany(guildId, items, request, request.placement === "next" ? "next" : "append");
    return { title, result, notes };
  }

  /**
   * Queues several items at once (a saved playlist, or every song of a playlist link). "replace" stops the
   * current track and empties the queue first; "append" adds to the end; "next" adds in front of the queue
   * ("Play next" on the website). Joins the requester's voice channel if needed. Songs over the server's length
   * limit, or past its queue limit, are left out and counted.
   */
  async addMany(
    guildId: string,
    items: QueueItem[],
    request: VoiceRequest,
    mode: PlaylistPlayMode | "next",
  ): Promise<AddManyResult> {
    const allowed = items.filter((item) => !this.isTooLong(guildId, item.durationMs));
    const tooLong = items.length - allowed.length;
    if (allowed.length === 0) {
      throw new UserError(tooLong > 0 ? "Every song is longer than this server allows." : "There are no songs to add.");
    }

    const player = this.getOrCreatePlayer(guildId);
    const added = await player.run(async () => {
      if (mode === "replace") return player.replaceQueue(allowed, request.voiceChannelId, request.textChannelId);
      await player.ensureConnected(request.voiceChannelId, request.textChannelId);
      return player.enqueueMany(allowed, mode === "next" ? "next" : "end");
    });
    return { added, tooLong, queueFull: allowed.length - added };
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

  /** Resumes the paused track. After a restart, continues the interrupted track in the requester's voice channel. */
  async resume(guildId: string, request: VoiceRequest): Promise<void> {
    const player = this.requirePlayer(guildId);
    await player.run(() => player.resume(request.voiceChannelId, request.textChannelId));
  }

  async setVolume(guildId: string, volume: number): Promise<void> {
    const player = this.requirePlayer(guildId);
    await player.run(() => player.setVolume(volume));
  }

  /** Jumps to a point in the current track (milliseconds from its start). */
  async seek(guildId: string, positionMs: number): Promise<void> {
    const player = this.requirePlayer(guildId);
    await player.run(() => player.seek(positionMs));
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

  /** Skips to a queued item: it starts playing now, and the current track is skipped. Returns the item. */
  async playNow(guildId: string, itemId: string): Promise<QueueItem> {
    const player = this.requirePlayer(guildId);
    return player.run(() => player.playNow(itemId));
  }

  async shuffle(guildId: string): Promise<void> {
    const player = this.requirePlayer(guildId);
    await player.run(async () => player.shuffle());
  }

  /** Empties the queue; the current track keeps playing. Returns how many items were removed. */
  async clearQueue(guildId: string): Promise<number> {
    const player = this.players.get(guildId);
    if (!player) return 0;
    return player.run(async () => player.clearQueue());
  }

  /** Empties the "Recently played" list. Returns how many items were removed. */
  async clearHistory(guildId: string): Promise<number> {
    const player = this.players.get(guildId);
    if (!player) return 0;
    return player.run(async () => player.clearHistory());
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
      interrupted: false,
      volume: this.settings.guild(guildId).defaultVolume,
      loopMode: "off",
      filter: "off",
      queue: [],
      history: [],
    };
  }

  /**
   * Tells the manager how many people (not counting bots) are in the bot's voice channel.
   * The bot calls this whenever someone joins, leaves or moves. With nobody left, the bot waits for the
   * server's `leaveWhenEmptyAfterSec` setting and then stops and leaves, unless someone comes back first.
   */
  updateListenerCount(guildId: string, listeners: number): void {
    const pendingLeave = this.leaveTimers.get(guildId);

    if (listeners > 0) {
      if (pendingLeave) this.cancelLeaveTimer(guildId);
      return;
    }

    const isInVoice = this.players.get(guildId)?.voiceChannelId;
    if (pendingLeave || !isInVoice) return;

    const delaySec = this.settings.guild(guildId).leaveWhenEmptyAfterSec;
    if (delaySec === 0) return; // 0 = never leave

    const timer = setTimeout(() => {
      this.leaveTimers.delete(guildId);
      this.stop(guildId).catch((error) => this.emit("error", guildId, null, error));
    }, delaySec * 1000);
    this.leaveTimers.set(guildId, timer);
  }

  /**
   * After a restart, rejoins the voice channels where the bot was playing and continues the songs from where
   * they stopped, but only where people are still listening (`hasListeners` asks Discord) and the song wasn't
   * paused. Everywhere else the song waits, paused, for /resume or /play. Needs Lavalink to be connected.
   */
  async rejoinAfterRestart(hasListeners: (guildId: string, voiceChannelId: string) => boolean): Promise<void> {
    for (const player of this.players.values()) {
      const interrupted = player.interrupted;
      if (!interrupted?.voiceChannelId || interrupted.wasPaused) continue;
      if (!hasListeners(player.guildId, interrupted.voiceChannelId)) continue;

      console.log(`[player] ${player.guildId}: continuing "${player.current?.title}" after the restart`);
      // Through run(), in case someone used /play or /resume in the meantime; then there's nothing left to do.
      await player
        .run(() => player.ensureConnected(interrupted.voiceChannelId, interrupted.textChannelId))
        .catch((error) => this.emit("error", player.guildId, player.current, error));
    }
  }

  /** Called when the bot shuts down, before it leaves voice. Keeps the saved state as it is for the next start. */
  stopSaving(): void {
    this.saving = false;
  }

  /** Saves a server's whole playback state. Called by GuildPlayer whenever the track or the queue changes. */
  saveState(state: SavedPlayer): void {
    if (this.saving) this.store.save(state);
  }

  /** Saves the position, pause, volume, loop mode and effect. Called by GuildPlayer about once a second while playing. */
  saveStatus(status: SavedStatus): void {
    if (this.saving) this.store.saveStatus(status);
  }

  /** Where a library file of this server is on disk, or null if it was deleted. Used when a queued file's turn comes. */
  libraryFilePath(guildId: string, fileId: string): string | null {
    const file = this.library.get(guildId, fileId);
    return file ? libraryFilePath(guildId, file.fileName) : null;
  }

  /** Refuses songs longer than the server's `maxTrackDurationSec` setting. Livestreams have no length and are allowed. */
  private checkDurationLimit(guildId: string, meta: Pick<TrackMetadata, "durationMs">): void {
    if (this.isTooLong(guildId, meta.durationMs)) {
      const limitMs = this.settings.guild(guildId).maxTrackDurationSec! * 1000;
      throw new UserError(
        `That song is ${formatDuration(meta.durationMs)} long; this server allows songs up to ${formatDuration(limitMs)}.`,
      );
    }
  }

  /** Whether a song is longer than the server's `maxTrackDurationSec` setting. Unknown lengths (livestreams) aren't. */
  private isTooLong(guildId: string, durationMs: number | undefined): boolean {
    const limitSec = this.settings.guild(guildId).maxTrackDurationSec;
    return limitSec !== null && durationMs !== undefined && durationMs > limitSec * 1000;
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
    // Passing it on keeps the website's progress bar in sync, and saves the position (GuildPlayer.emitPlayerUpdate).
    this.lavalink.on("playerUpdate", (_oldState, lavalinkPlayer) => {
      const player = this.players.get(lavalinkPlayer.guildId);
      if (player?.current) player.emitPlayerUpdate();
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
