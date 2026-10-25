import type { Player, Track, TrackEndReason } from "lavalink-client";
import type { SavedPlayer } from "../db/playerStateStore.js";
import { playbackRate } from "../shared/filters.js";
import { MAX_VOLUME } from "../shared/player.js";
import type { YoutubeMode } from "../shared/settings.js";
import type { AudioFilter, LoopMode, PlayerSnapshot, QueueItem } from "../shared/types.js";
import { UserError } from "./errors.js";
import { applyFilter } from "./filters.js";
import type { PlayerManager } from "./PlayerManager.js";
import { fallbackMethod, type ResolveMethod, resolvePlayable } from "./resolvers/index.js";

interface StartOptions {
  /** Load the item only this way (used to retry with yt-dlp). By default every method is tried in order. */
  method?: ResolveMethod;
  /** Where to start playing, e.g. where a failed attempt stopped. */
  startAtMs?: number;
}

/**
 * A track that was playing when the bot stopped (a restart or a crash), and hasn't been continued yet.
 * See `GuildPlayer.interrupted`.
 */
export interface InterruptedPlayback {
  /** Where the track had got to, in song time. */
  positionMs: number;
  /** The volume to rejoin with. */
  volume: number;
  /** Whether it was paused. A paused track isn't continued automatically, only with /resume or /play. */
  wasPaused: boolean;
  /** Where the bot was in voice, and where it posted errors. */
  voiceChannelId: string | null;
  textChannelId: string | null;
}

export { MAX_VOLUME };
/** How many recently played items to remember. */
const HISTORY_SIZE = 20;

/**
 * The playback state of one Discord server: what's playing now and what's queued after it.
 *
 * We keep our own queue instead of using lavalink-client's built-in one, because our queue stores the
 * original link (not a resolved track) and resolves it only right before it plays. The Lavalink player
 * is just told "play this one track now".
 *
 * Queue positions are 1-based, as shown in /queue: position 1 is the next item to play.
 *
 * Don't call the methods below directly; go through PlayerManager, which wraps them in `run()`.
 */
export class GuildPlayer {
  /** The item playing right now, or null when idle. */
  current: QueueItem | null = null;
  /** Items waiting to play, in order. Does not include `current`. */
  queue: QueueItem[] = [];
  /** Recently played items, newest first (at most HISTORY_SIZE). */
  history: QueueItem[] = [];
  loopMode: LoopMode = "off";
  filter: AudioFilter = "off";

  /**
   * Set after a restart when a track was playing: `current` is that track, but Lavalink isn't playing it and
   * the bot isn't in voice. The next `ensureConnected()` (from /resume, /play, or the bot rejoining by itself
   * because people are still in its channel) continues it from where it stopped. See `restore()`.
   */
  interrupted: InterruptedPlayback | null = null;

  /** The tail of the task queue used by `run()`. */
  private lastTask: Promise<unknown> = Promise.resolve();

  /**
   * Set when Lavalink reports a stuck track. Lavalink then stops that track, which ends it with reason
   * "stopped", the same reason as a user's /stop. This flag tells `onTrackEnded` to treat that particular
   * "stopped" as "move on to the next track".
   */
  private advanceAfterStuckTrack = false;

  /** How the current track was loaded (Lavalink or yt-dlp), so a playback failure knows what's left to try. */
  private currentMethod: ResolveMethod | null = null;
  /**
   * Set when Lavalink fails to play the current track but another method can still load it. The
   * "loadFailed" track end that follows then retries with that method, from where playback stopped (`fromMs`).
   */
  private pendingRetry: { method: ResolveMethod; fromMs: number } | null = null;

  /**
   * Lavalink reports the position in *real* time, not song time: under nightcore (1.21× speed) a 2:37 song
   * ends while Lavalink says about 2:10. So the song position is worked out from the last moment both were
   * known to agree (a track start, a seek, or an effect change):
   *   song position = anchor.songMs + (Lavalink's position − anchor.lavalinkMs) × the effect's speed.
   * See `songPositionMs()`.
   */
  private speedAnchor = { lavalinkMs: 0, songMs: 0 };

  constructor(
    readonly guildId: string,
    private readonly manager: PlayerManager,
  ) {}

  /** The lavalink-client player for this server, if the bot has joined voice. */
  private get lavalinkPlayer(): Player | undefined {
    return this.manager.lavalink.getPlayer(this.guildId);
  }

  get voiceChannelId(): string | null {
    return this.lavalinkPlayer?.voiceChannelId ?? null;
  }

  /**
   * Runs `task` after every previously queued task has finished, one at a time.
   *
   * Without this, two things happening at once (say, /skip while a track ends by itself) could both read
   * `current` before either updates it, and both would advance the queue.
   */
  run<T>(task: () => Promise<T>): Promise<T> {
    // Start after the previous task, whether it succeeded or failed.
    const result = this.lastTask.then(task, task);
    // A failure is reported to whoever awaits `result`; it must not break the tasks after it.
    this.lastTask = result.catch(() => {});
    return result;
  }

  // ---------------------------------------------------------------------------------------------
  // Joining voice and adding to the queue
  // ---------------------------------------------------------------------------------------------

  /**
   * Joins the given voice channel if the bot isn't connected yet. If it already is, it stays where it is.
   * After a restart, joining also continues the interrupted track (see `interrupted`).
   */
  async ensureConnected(voiceChannelId: string | null, textChannelId: string | null): Promise<Player> {
    const existing = this.lavalinkPlayer;
    if (existing?.connected) return existing;

    if (!voiceChannelId) throw new UserError("Join a voice channel first.");

    const player =
      existing ??
      this.manager.lavalink.createPlayer({
        guildId: this.guildId,
        voiceChannelId,
        // From the website there's no text channel; after a restart, keep posting where playback was started.
        textChannelId: textChannelId ?? this.interrupted?.textChannelId ?? undefined,
        selfDeaf: true,
        volume: this.interrupted?.volume ?? this.manager.settings.guild(this.guildId).defaultVolume,
      });
    await player.connect();
    // A new Lavalink player has no effect on. `filter` is only set at this point when it was restored after a restart.
    if (this.filter !== "off") await applyFilter(player, this.filter);
    if (this.interrupted) await this.continueInterrupted();
    return player;
  }

  /**
   * Adds an item to the queue. If nothing is playing, it starts right away.
   *
   * `loadedTrack` is the track Lavalink loaded to read the item's title, if it did. Reusing it saves loading
   * the link a second time when the item plays immediately. Items that wait in the queue are loaded again
   * when their turn comes.
   *
   * Returns the item's position: 0 means it is playing now, 1 means it is next, and so on.
   */
  async enqueue(item: QueueItem, loadedTrack?: Track): Promise<{ position: number }> {
    if (this.current) {
      const { maxQueueLength } = this.manager.settings.guild(this.guildId);
      if (maxQueueLength !== null && this.queue.length >= maxQueueLength) {
        throw new UserError(`The queue is full (this server's limit is ${maxQueueLength} songs).`);
      }
      this.queue.push(item);
      this.emitQueueUpdate();
      return { position: this.queue.length };
    }

    try {
      if (loadedTrack) {
        this.setCurrent(item, "lavalink");
        await this.playTrack(loadedTrack);
      } else {
        await this.startItem(item);
      }
    } catch (error) {
      this.setCurrent(null, null);
      throw error;
    }
    return { position: 0 };
  }

  // ---------------------------------------------------------------------------------------------
  // Playback controls
  // ---------------------------------------------------------------------------------------------

  /**
   * Skips the current track. Returns the skipped item, or null if nothing was playing.
   * In "queue" loop mode the skipped item goes to the end of the queue; otherwise it's dropped.
   */
  async skip(): Promise<QueueItem | null> {
    const skipped = this.current;
    if (!skipped) return null;

    this.manager.emit("track:end", this.guildId, skipped, "skipped");
    this.addToHistory(skipped);
    if (this.loopMode === "queue") this.queue.push(skipped);

    if (this.interrupted) {
      // Not in voice, so nothing can play: the next item waits to be continued, from its start.
      const next = this.queue.shift() ?? null;
      this.interrupted = next ? { ...this.interrupted, positionMs: 0 } : null;
      this.setCurrent(next, null);
      return skipped;
    }
    await this.playNext();
    return skipped;
  }

  /** Clears the queue, stops playback and leaves the voice channel. */
  async stop(): Promise<void> {
    this.reset();
    await this.lavalinkPlayer?.destroy("stopped");
  }

  async pause(): Promise<void> {
    const player = this.requirePlaying();
    if (player.paused) throw new UserError("Already paused.");
    await player.pause();
    this.emitPlayerUpdate();
  }

  /**
   * Resumes the paused track. After a restart it continues the interrupted track instead, joining the
   * requester's voice channel (`voiceChannelId`) to do so.
   */
  async resume(voiceChannelId: string | null, textChannelId: string | null): Promise<void> {
    if (this.interrupted) {
      await this.ensureConnected(voiceChannelId, textChannelId);
      return;
    }
    const player = this.requirePlaying();
    if (!player.paused) throw new UserError("Not paused.");
    await player.resume();
    this.emitPlayerUpdate();
  }

  /** Sets the volume in percent (0 to MAX_VOLUME). Applies until the bot leaves voice. */
  async setVolume(volume: number): Promise<void> {
    if (!Number.isInteger(volume) || volume < 0 || volume > MAX_VOLUME) {
      throw new UserError(`Volume must be a whole number from 0 to ${MAX_VOLUME}.`);
    }
    const player = this.requireConnected();
    await player.setVolume(volume);
    this.emitPlayerUpdate();
  }

  /** Jumps to a point in the current track, in milliseconds from its start. */
  async seek(positionMs: number): Promise<void> {
    const player = this.requirePlaying();
    const item = this.current!;
    if (item.isStream || !player.queue.current?.info.isSeekable) throw new UserError("This track can't be seeked.");
    if (!Number.isFinite(positionMs) || positionMs < 0) throw new UserError("The position must be 0 or more.");

    const target = Math.min(Math.round(positionMs), item.durationMs ?? positionMs);
    await player.seek(target);
    // After a seek, Lavalink's position and the song's position agree again (see `speedAnchor`).
    this.speedAnchor = { lavalinkMs: target, songMs: target };
    this.emitPlayerUpdate();
  }

  setLoopMode(mode: LoopMode): void {
    this.loopMode = mode;
    this.emitPlayerUpdate();
  }

  /** Switches to an audio effect ("off" removes it). It stays on for the following tracks until changed. */
  async setFilter(filter: AudioFilter): Promise<void> {
    const player = this.requireConnected();

    const songMs = this.songPositionMs(); // measured at the old speed, before switching
    await applyFilter(player, filter);
    this.filter = filter;

    // Seeking to where the song is makes the new effect audible right away; otherwise Lavalink first plays
    // the few seconds of audio it already prepared with the old effect. It also makes Lavalink's position
    // equal the song position again, which the speed conversion counts from.
    if (this.current && player.queue.current?.info.isSeekable) {
      await player.seek(songMs);
      this.speedAnchor = { lavalinkMs: songMs, songMs };
    } else {
      this.speedAnchor = { lavalinkMs: player.position, songMs };
    }
    this.emitPlayerUpdate();
  }

  // ---------------------------------------------------------------------------------------------
  // Editing the queue
  // ---------------------------------------------------------------------------------------------

  /** Removes a queued item. Returns the removed item. */
  remove(itemId: string): QueueItem {
    const index = this.findQueueIndex(itemId);
    const [removed] = this.queue.splice(index, 1);
    this.emitQueueUpdate();
    return removed!;
  }

  /** Moves a queued item to a new position (1 = next). Returns the moved item. */
  move(itemId: string, toPosition: number): QueueItem {
    if (!Number.isInteger(toPosition) || toPosition < 1 || toPosition > this.queue.length) {
      throw new UserError(`The new position must be from 1 to ${this.queue.length}.`);
    }
    const index = this.findQueueIndex(itemId);
    const [item] = this.queue.splice(index, 1);
    this.queue.splice(toPosition - 1, 0, item!);
    this.emitQueueUpdate();
    return item!;
  }

  /** Shuffles the queue into a random order. The current track keeps playing. */
  shuffle(): void {
    if (this.queue.length < 2) throw new UserError("There's nothing to shuffle.");
    // Fisher-Yates: walk backwards, swapping each item with a random one at or before it.
    for (let i = this.queue.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.queue[i], this.queue[j]] = [this.queue[j]!, this.queue[i]!];
    }
    this.emitQueueUpdate();
  }

  /** Removes everything waiting in the queue. The current track keeps playing. Returns how many were removed. */
  clearQueue(): number {
    const removed = this.queue.length;
    this.queue = [];
    this.emitQueueUpdate();
    return removed;
  }

  /** Forgets the "Recently played" list. Returns how many items it held. */
  clearHistory(): number {
    const removed = this.history.length;
    this.history = [];
    this.emitQueueUpdate();
    return removed;
  }

  // ---------------------------------------------------------------------------------------------
  // Reacting to Lavalink events (called by PlayerManager)
  // ---------------------------------------------------------------------------------------------

  /**
   * Called when Lavalink reports that the current track ended. Lavalink's end reasons:
   * - "finished": it played to the end → apply the loop mode, then play the next one.
   * - "loadFailed": it couldn't be played → play the next one (the error was already reported).
   *    A broken item is never looped, so a bad link can't fail over and over.
   * - "stopped": we stopped it ourselves (/stop, or /skip on the last track) → do nothing,
   *    unless it was stopped because it got stuck (then treat it like "loadFailed").
   * - "replaced": we started another track over it (/skip) → do nothing, the new track is already playing.
   * - "cleanup": the player was destroyed → do nothing.
   */
  async onTrackEnded(reason: TrackEndReason): Promise<void> {
    const wasStuck = this.advanceAfterStuckTrack;
    this.advanceAfterStuckTrack = false;
    const retry = this.pendingRetry;
    this.pendingRetry = null;

    const ended = this.current;
    const playedToTheEnd = reason === "finished";
    const failed = reason === "loadFailed" || (reason === "stopped" && wasStuck);
    if (!ended || (!playedToTheEnd && !failed)) return;

    // Lavalink couldn't play it, but another method might (e.g. yt-dlp after YouTube blocked the plugin).
    if (failed && retry) {
      const retried = await this.tryToPlay(ended, { method: retry.method, startAtMs: retry.fromMs });
      if (retried) return;
    }

    this.manager.emit("track:end", this.guildId, ended, reason);
    if (playedToTheEnd) this.addToHistory(ended);

    if (playedToTheEnd && this.loopMode === "track") {
      const replayed = await this.tryToPlay(ended);
      if (replayed) return;
    }
    if (playedToTheEnd && this.loopMode === "queue") {
      this.queue.push(ended);
    }
    await this.playNext();
  }

  /** Called when Lavalink reports that the current track stopped producing audio. See `advanceAfterStuckTrack`. */
  onTrackStuck(): void {
    this.advanceAfterStuckTrack = true;
  }

  /**
   * Called when Lavalink fails to play the current track. If another method can still load it, a retry is
   * scheduled (see `pendingRetry`) and the error isn't worth showing to users.
   * Returns true if the error should be reported.
   */
  onTrackError(): boolean {
    if (!this.current || !this.currentMethod) return true;
    const method = fallbackMethod(this.current.source, this.currentMethod, this.youtubeMode());
    if (!method) return true;

    this.pendingRetry = { method, fromMs: this.songPositionMs() };
    console.warn(`[player] ${this.currentMethod} couldn't play "${this.current.title}"; retrying with ${method}`);
    return false;
  }

  /** Forgets the current track and the queue, e.g. after the bot was disconnected from voice. The history stays. */
  reset(): void {
    this.setCurrent(null, null);
    this.queue = [];
    this.loopMode = "off";
    this.filter = "off"; // a new Lavalink player starts without effects
    this.interrupted = null;
    this.advanceAfterStuckTrack = false;
    this.pendingRetry = null;
    this.emitQueueUpdate();
  }

  /**
   * Takes over the state saved before a restart (see PlayerStateStore). A track that was playing becomes
   * `interrupted`: it continues once the bot is back in voice. Called once, right after the player is created.
   */
  restore(saved: SavedPlayer): void {
    this.current = saved.current;
    this.queue = saved.queue;
    this.history = saved.history;
    this.loopMode = saved.loopMode;
    this.filter = saved.filter;
    this.interrupted = saved.current
      ? {
          positionMs: saved.positionMs,
          volume: saved.volume,
          wasPaused: saved.paused,
          voiceChannelId: saved.voiceChannelId,
          textChannelId: saved.textChannelId,
        }
      : null;
  }

  /** A copy of the current state, safe to send to Discord or the website. */
  snapshot(): PlayerSnapshot {
    const player = this.lavalinkPlayer;
    const interrupted = this.interrupted;
    return {
      guildId: this.guildId,
      voiceChannelId: this.voiceChannelId,
      current: this.current,
      positionMs: interrupted ? interrupted.positionMs : this.current ? this.songPositionMs() : 0,
      paused: interrupted ? true : (player?.paused ?? false),
      interrupted: interrupted !== null,
      volume: interrupted?.volume ?? player?.volume ?? this.manager.settings.guild(this.guildId).defaultVolume,
      loopMode: this.loopMode,
      filter: this.filter,
      queue: [...this.queue],
      history: [...this.history],
    };
  }

  /** What to save so playback can continue after a restart. */
  private savedState(): SavedPlayer {
    const snapshot = this.snapshot();
    const player = this.lavalinkPlayer;
    const interrupted = this.interrupted;
    return {
      guildId: this.guildId,
      // While still interrupted, keep the channels saved before, so a second restart can rejoin there too.
      voiceChannelId: interrupted ? interrupted.voiceChannelId : (player?.voiceChannelId ?? null),
      textChannelId: interrupted ? interrupted.textChannelId : (player?.textChannelId ?? null),
      current: snapshot.current,
      positionMs: snapshot.positionMs,
      paused: interrupted ? interrupted.wasPaused : snapshot.paused,
      volume: snapshot.volume,
      loopMode: snapshot.loopMode,
      filter: snapshot.filter,
      queue: snapshot.queue,
      history: snapshot.history,
    };
  }

  // ---------------------------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------------------------

  /**
   * Plays queued items in order until one works. Items that can't be loaded are reported and dropped.
   * When the queue runs out, playback stops but the bot stays in voice.
   */
  private async playNext(): Promise<void> {
    while (this.queue.length > 0) {
      const next = this.queue.shift()!;
      const started = await this.tryToPlay(next);
      if (started) return;
    }

    // Nothing left to play.
    this.setCurrent(null, null);
    const player = this.lavalinkPlayer;
    // If Lavalink is still playing the old track (we got here through /skip), stop it.
    if (player?.queue.current) await player.stopPlaying(/* clearQueue */ false, /* executeAutoplay */ false);
  }

  /** Like `startItem`, but reports a failure instead of throwing it. Returns whether the item started. */
  private async tryToPlay(item: QueueItem, options: StartOptions = {}): Promise<boolean> {
    try {
      await this.startItem(item, options);
      return true;
    } catch (error) {
      this.manager.emit("error", this.guildId, item, error);
      return false;
    }
  }

  /**
   * Makes `item` the current item, loads its link and plays it. `options.method` forces one way of loading
   * (used for retries); otherwise the methods are tried in their normal order.
   */
  private async startItem(item: QueueItem, options: StartOptions = {}): Promise<void> {
    this.setCurrent(item, null);
    const { track, method } = await resolvePlayable(this.manager.lavalink, item.source, item.requestedBy, {
      youtubeMode: this.youtubeMode(),
      only: options.method,
    });
    this.currentMethod = method;
    await this.playTrack(track, options.startAtMs);
  }

  /** Tells Lavalink to play `track` now, replacing whatever it is playing. */
  private async playTrack(track: Track, startAtMs = 0): Promise<void> {
    const player = this.lavalinkPlayer;
    if (!player) throw new UserError("Not connected to a voice channel.");
    // Lavalink stays paused across track changes; a new track should always be heard.
    // Always passing `position` (even 0) makes lavalink-client reset its position for the new track at once.
    await player.play({ clientTrack: track, paused: false, position: startAtMs });
    this.speedAnchor = { lavalinkMs: startAtMs, songMs: startAtMs };
  }

  /** Where the current song is, in song time (see `speedAnchor`), kept between 0 and its length. */
  private songPositionMs(): number {
    const lavalinkMs = this.lavalinkPlayer?.position ?? 0;
    const songMs = this.speedAnchor.songMs + (lavalinkMs - this.speedAnchor.lavalinkMs) * playbackRate(this.filter);
    return Math.max(0, Math.min(songMs, this.current?.durationMs ?? Infinity));
  }

  private setCurrent(item: QueueItem | null, method: ResolveMethod | null): void {
    this.current = item;
    this.currentMethod = method;
    this.emitQueueUpdate();
  }

  /** The Lavalink player, if something is playing. Throws "Nothing is playing" otherwise. */
  private requirePlaying(): Player {
    const player = this.requireConnected();
    if (!this.current) throw new UserError("Nothing is playing.");
    return player;
  }

  /** The Lavalink player, if the bot is in voice. Throws a message saying what to do otherwise. */
  private requireConnected(): Player {
    if (this.interrupted) throw new UserError("Playback stopped when the bot restarted. Use /resume to continue.");
    const player = this.lavalinkPlayer;
    if (!player) throw new UserError("Not connected to a voice channel.");
    return player;
  }

  /**
   * Plays the track that was interrupted by a restart, from where it stopped. If it can't be loaded any more,
   * the queue moves on. Called by `ensureConnected()` once the bot is back in voice.
   */
  private async continueInterrupted(): Promise<void> {
    const { positionMs } = this.interrupted!;
    this.interrupted = null;
    const started = await this.tryToPlay(this.current!, { startAtMs: positionMs });
    if (!started) await this.playNext();
  }

  /** The owner's YouTube setting, read every time so a change applies to the next song. */
  private youtubeMode(): YoutubeMode {
    return this.manager.settings.global().youtubeMode;
  }

  private findQueueIndex(itemId: string): number {
    const index = this.queue.findIndex((item) => item.id === itemId);
    if (index === -1) throw new UserError("That item isn't in the queue any more.");
    return index;
  }

  /** Remembers a track that played (to the end, or until skipped). A track looping on repeat is listed once. */
  private addToHistory(item: QueueItem): void {
    if (this.history[0]?.id === item.id) return;
    this.history.unshift(item);
    this.history.length = Math.min(this.history.length, HISTORY_SIZE);
  }

  /** Saves the whole state and tells everyone that the track or the queue changed. */
  private emitQueueUpdate(): void {
    this.manager.saveState(this.savedState());
    this.manager.emit("queue:update", this.guildId, this.snapshot());
  }

  /**
   * Saves the position, pause, volume, loop mode and effect, and tells everyone they changed. PlayerManager
   * also calls this about once a second while playing, so a crash loses at most a second or so of position.
   */
  emitPlayerUpdate(): void {
    this.manager.saveStatus(this.savedState());
    this.manager.emit("player:update", this.guildId, this.snapshot());
  }
}
