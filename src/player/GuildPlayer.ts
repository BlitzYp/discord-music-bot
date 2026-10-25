import type { Player, Track, TrackEndReason } from "lavalink-client";
import type { PlayerSnapshot, QueueItem } from "../shared/types.js";
import { UserError } from "./errors.js";
import type { PlayerManager } from "./PlayerManager.js";
import { resolvePlayable } from "./resolvers/index.js";

/**
 * The playback state of one Discord server: what's playing now and what's queued after it.
 *
 * We keep our own queue instead of using lavalink-client's built-in one, because our queue stores the
 * original link (not a resolved track) and resolves it only right before it plays. The Lavalink player
 * is just told "play this one track now".
 *
 * Don't call the methods below directly; go through PlayerManager, which wraps them in `run()`.
 */
export class GuildPlayer {
  /** The item playing right now, or null when idle. */
  current: QueueItem | null = null;
  /** Items waiting to play, in order. Does not include `current`. */
  queue: QueueItem[] = [];

  /** The tail of the task queue used by `run()`. */
  private lastTask: Promise<unknown> = Promise.resolve();

  /**
   * Set when Lavalink reports a stuck track. Lavalink then stops that track, which ends it with reason
   * "stopped", the same reason as a user's /stop. This flag tells `onTrackEnded` to treat that particular
   * "stopped" as "move on to the next track".
   */
  private advanceAfterStuckTrack = false;

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

  /** Joins the given voice channel if the bot isn't connected yet. If it already is, it stays where it is. */
  async ensureConnected(voiceChannelId: string | null, textChannelId: string | null): Promise<Player> {
    const existing = this.lavalinkPlayer;
    if (existing?.connected) return existing;

    if (!voiceChannelId) throw new UserError("Join a voice channel first.");

    const player =
      existing ??
      this.manager.lavalink.createPlayer({
        guildId: this.guildId,
        voiceChannelId,
        textChannelId: textChannelId ?? undefined,
        selfDeaf: true,
        volume: 100,
      });
    await player.connect();
    return player;
  }

  /**
   * Adds an item to the queue. If nothing is playing, it starts right away.
   *
   * `loadedTrack` is the track that was loaded to read the item's title. Reusing it here saves loading the
   * link a second time when the item plays immediately. Items that wait in the queue are loaded again when
   * their turn comes.
   *
   * Returns the item's position: 0 means it is playing now, 1 means it is next, and so on.
   */
  async enqueue(item: QueueItem, loadedTrack: Track): Promise<{ position: number }> {
    if (this.current) {
      this.queue.push(item);
      this.emitQueueUpdate();
      return { position: this.queue.length };
    }

    this.current = item;
    this.emitQueueUpdate();
    try {
      await this.playTrack(loadedTrack);
    } catch (error) {
      this.current = null;
      this.emitQueueUpdate();
      throw error;
    }
    return { position: 0 };
  }

  /** Skips the current track. Returns the skipped item, or null if nothing was playing. */
  async skip(): Promise<QueueItem | null> {
    const skipped = this.current;
    if (!skipped) return null;

    this.manager.emit("track:end", this.guildId, skipped, "skipped");
    await this.playNext();
    return skipped;
  }

  /** Clears the queue, stops playback and leaves the voice channel. */
  async stop(): Promise<void> {
    this.reset();
    await this.lavalinkPlayer?.destroy("stopped by user");
  }

  /**
   * Called when Lavalink reports that the current track ended. Lavalink's end reasons:
   * - "finished": it played to the end → play the next one.
   * - "loadFailed": it couldn't be played → play the next one (the error was already reported).
   * - "stopped": we stopped it ourselves (/stop, or /skip on the last track) → do nothing,
   *    unless it was stopped because it got stuck.
   * - "replaced": we started another track over it (/skip) → do nothing, the new track is already playing.
   * - "cleanup": the player was destroyed → do nothing.
   */
  async onTrackEnded(reason: TrackEndReason): Promise<void> {
    const wasStuck = this.advanceAfterStuckTrack;
    this.advanceAfterStuckTrack = false;

    const shouldPlayNext = reason === "finished" || reason === "loadFailed" || (reason === "stopped" && wasStuck);
    if (!shouldPlayNext || !this.current) return;

    this.manager.emit("track:end", this.guildId, this.current, reason);
    await this.playNext();
  }

  /** Called when Lavalink reports that the current track stopped producing audio. See `advanceAfterStuckTrack`. */
  onTrackStuck(): void {
    this.advanceAfterStuckTrack = true;
  }

  /** Forgets the current track and the queue, e.g. after the bot was disconnected from voice. */
  reset(): void {
    this.current = null;
    this.queue = [];
    this.advanceAfterStuckTrack = false;
    this.emitQueueUpdate();
  }

  /** A copy of the current state, safe to send to Discord or the website. */
  snapshot(): PlayerSnapshot {
    const player = this.lavalinkPlayer;
    return {
      guildId: this.guildId,
      voiceChannelId: this.voiceChannelId,
      current: this.current,
      positionMs: this.current ? (player?.position ?? 0) : 0,
      paused: player?.paused ?? false,
      queue: [...this.queue],
    };
  }

  /**
   * Moves the next queued item into `current` and plays it. If an item can't be loaded, the error is
   * reported and the one after it is tried. When the queue runs out, playback stops but the bot stays in voice.
   */
  private async playNext(): Promise<void> {
    while (this.queue.length > 0) {
      const next = this.queue.shift()!;
      this.current = next;
      this.emitQueueUpdate();

      try {
        const track = await resolvePlayable(this.manager.lavalink, next.source, next.requestedBy);
        await this.playTrack(track);
        return;
      } catch (error) {
        this.manager.emit("error", this.guildId, next, error);
      }
    }

    // Nothing left to play.
    this.current = null;
    this.emitQueueUpdate();
    const player = this.lavalinkPlayer;
    // If Lavalink is still playing the old track (we got here through /skip), stop it.
    if (player?.queue.current) await player.stopPlaying(/* clearQueue */ false, /* executeAutoplay */ false);
  }

  /** Tells Lavalink to play `track` now, replacing whatever it is playing. */
  private async playTrack(track: Track): Promise<void> {
    const player = this.lavalinkPlayer;
    if (!player) throw new UserError("Not connected to a voice channel.");
    await player.play({ clientTrack: track });
  }

  private emitQueueUpdate(): void {
    this.manager.emit("queue:update", this.guildId, this.snapshot());
  }
}
