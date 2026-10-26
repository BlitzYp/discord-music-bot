import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import type { NewPlaylistItem, PlaylistStore } from "../db/playlistStore.js";
import { NotAllowedError, UserError } from "../player/errors.js";
import type { PlayerManager, VoiceRequest } from "../player/PlayerManager.js";
import { findSong, listPlaylist, type PlaylistEntry, parseInput } from "../player/resolvers/index.js";
import {
  type AddManyResult,
  type AddedBy,
  MAX_PLAYLIST_NAME_LENGTH,
  isYoutubePlaylistLink,
  MAX_PLAYLIST_SONGS,
  type PlaylistDetails,
  type PlaylistItem,
  type PlaylistPlayMode,
  type PlaylistSummary,
} from "../shared/playlists.js";
import type { QueueItem, Requester } from "../shared/types.js";

/** Events PlaylistManager emits. src/web/socket.ts tells the server's open pages to reload their playlists. */
export interface PlaylistManagerEvents {
  /** A playlist of this server was created, renamed, deleted, or had songs added, removed or moved. */
  change: [guildId: string];
}

/** Who is removing a playlist song: DJs may remove any song, everyone else only the songs they added. */
export interface SongRemover {
  id: string;
  isDj: boolean;
}

/** What an import did: the playlist it went into, how many songs were added, and how many didn't fit. */
export interface ImportResult {
  playlist: PlaylistSummary;
  added: number;
  /** Songs left out because the playlist reached MAX_PLAYLIST_SONGS. */
  didNotFit: number;
}

/**
 * Each server's saved playlists: creating, editing, importing and playing them.
 *
 * Like PlayerManager for playback, this is the one place with the playlist rules, so `/playlist` and the
 * website's Playlists tab behave the same. Who may call what (member or DJ) is checked before calling, by the
 * command or the route; the one rule that depends on the song itself (members may remove only songs they added)
 * is checked here. Playing a playlist goes through PlayerManager like any other playback.
 */
export class PlaylistManager extends EventEmitter<PlaylistManagerEvents> {
  constructor(
    private readonly store: PlaylistStore,
    private readonly players: PlayerManager,
  ) {
    super();
  }

  // ---------------------------------------------------------------------------------------------
  // Reading
  // ---------------------------------------------------------------------------------------------

  list(guildId: string): PlaylistSummary[] {
    return this.store.list(guildId);
  }

  /** A playlist with its songs. Throws if the server has no playlist with that id (e.g. it was just deleted). */
  get(guildId: string, playlistId: number): PlaylistDetails {
    const playlist = this.store.details(guildId, playlistId);
    if (!playlist) throw new UserError("That playlist doesn't exist any more.");
    return playlist;
  }

  /** A playlist found by name (upper/lower case doesn't matter), or null. */
  findByName(guildId: string, name: string): PlaylistSummary | null {
    return this.store.findByName(guildId, name.trim().replace(/\s+/g, " "));
  }

  /** A playlist found by name (upper/lower case doesn't matter), with its songs. For slash commands. */
  getByName(guildId: string, name: string): PlaylistDetails {
    const found = this.findByName(guildId, name);
    if (!found) throw new UserError(`There's no playlist called "${name.trim()}". /playlist list shows them all.`);
    return this.get(guildId, found.id);
  }

  // ---------------------------------------------------------------------------------------------
  // Creating, renaming, deleting (DJs)
  // ---------------------------------------------------------------------------------------------

  /** Creates an empty playlist. */
  create(guildId: string, name: string, createdBy: AddedBy): PlaylistSummary {
    const cleanName = this.checkNewName(guildId, name);
    const playlistId = this.store.create(guildId, cleanName, createdBy);
    this.emit("change", guildId);
    return this.store.summary(guildId, playlistId)!;
  }

  /**
   * Creates a playlist from a playlist link (a YouTube playlist, or a video opened from one). Without a name,
   * it's named after the YouTube playlist (with a number added if that name is taken).
   */
  async createFromLink(guildId: string, name: string | null, url: string, createdBy: AddedBy): Promise<ImportResult> {
    // Check the name before reading the playlist, so a taken name fails straight away.
    const chosenName = name?.trim() ? this.checkNewName(guildId, name) : null;
    const { title, entries } = await this.readPlaylistLink(url, MAX_PLAYLIST_SONGS);

    // Reading the playlist took a few seconds; check the name again in case someone took it meanwhile.
    const finalName = chosenName ? this.checkNewName(guildId, chosenName) : this.freeNameLike(guildId, title);
    const playlistId = this.store.create(guildId, finalName, createdBy);
    this.store.addItems(playlistId, entries.map((entry) => toNewItem(entry, createdBy)));
    this.emit("change", guildId);
    return { playlist: this.store.summary(guildId, playlistId)!, added: entries.length, didNotFit: 0 };
  }

  rename(guildId: string, playlistId: number, name: string): PlaylistSummary {
    const playlist = this.get(guildId, playlistId);
    const cleanName = this.checkNewName(guildId, name, { renaming: playlist.id });
    this.store.rename(playlist.id, cleanName);
    this.emit("change", guildId);
    return this.store.summary(guildId, playlist.id)!;
  }

  delete(guildId: string, playlistId: number): PlaylistSummary {
    const playlist = this.get(guildId, playlistId);
    this.store.delete(playlist.id);
    this.emit("change", guildId);
    return playlist;
  }

  /** Saves the current track plus the queue as a new playlist. */
  saveQueue(guildId: string, name: string, createdBy: AddedBy): PlaylistSummary {
    const cleanName = this.checkNewName(guildId, name);
    const { current, queue } = this.players.getState(guildId);
    const items = current ? [current, ...queue] : queue;
    if (items.length === 0) throw new UserError("The queue is empty, so there's nothing to save.");

    const now = Date.now();
    const songs = items.slice(0, MAX_PLAYLIST_SONGS).map((item): NewPlaylistItem => ({
      source: item.source,
      title: item.title,
      author: item.author,
      durationMs: item.durationMs,
      isStream: item.isStream,
      thumbnail: item.thumbnail,
      // The person who queued each song added it, not the person saving the playlist.
      addedBy: { id: item.requestedBy.id, name: item.requestedBy.name },
      addedAt: now,
    }));
    const playlistId = this.store.create(guildId, cleanName, createdBy);
    this.store.addItems(playlistId, songs);
    this.emit("change", guildId);
    return this.store.summary(guildId, playlistId)!;
  }

  // ---------------------------------------------------------------------------------------------
  // Songs
  // ---------------------------------------------------------------------------------------------

  /**
   * Adds one link, or the best YouTube match for a search, to the end of a playlist (anyone in the server may).
   * Returns the new song.
   */
  async addSong(guildId: string, playlistId: number, input: string, addedBy: Requester): Promise<PlaylistItem> {
    this.checkRoom(this.get(guildId, playlistId));

    // Read the title and length now, so the playlist can show them. The link is loaded again when it plays.
    const youtubeMode = this.players.settings.global().youtubeMode;
    const { source, meta } = await findSong(this.players.lavalink, input, addedBy, youtubeMode);

    // Loading took a moment: make sure the playlist still exists and still has room.
    const playlist = this.get(guildId, playlistId);
    this.checkRoom(playlist);
    this.store.addItems(playlist.id, [toNewItem({ source, meta }, addedBy)]);
    this.emit("change", guildId);
    return this.get(guildId, playlistId).items.at(-1)!;
  }

  /** Adds the songs of a playlist link to the end of an existing playlist (DJs), as many as fit. */
  async importInto(guildId: string, playlistId: number, url: string, addedBy: AddedBy): Promise<ImportResult> {
    const room = this.checkRoom(this.get(guildId, playlistId));
    const { entries } = await this.readPlaylistLink(url, room);

    const playlist = this.get(guildId, playlistId);
    const fitting = entries.slice(0, MAX_PLAYLIST_SONGS - playlist.songCount);
    this.store.addItems(playlist.id, fitting.map((entry) => toNewItem(entry, addedBy)));
    this.emit("change", guildId);
    return { playlist: this.store.summary(guildId, playlist.id)!, added: fitting.length, didNotFit: entries.length - fitting.length };
  }

  /** Removes a song. DJs may remove any song; everyone else only the songs they added themselves. */
  removeSong(guildId: string, playlistId: number, itemId: number, by: SongRemover): PlaylistItem {
    const playlist = this.get(guildId, playlistId);
    const item = this.store.item(playlist.id, itemId);
    if (!item) throw new UserError("That song isn't in the playlist any more.");
    if (!by.isDj && item.addedBy.id !== by.id) {
      throw new NotAllowedError("Only DJs can remove songs that someone else added.");
    }
    this.store.removeItem(playlist.id, item.id);
    this.emit("change", guildId);
    return item;
  }

  /** Moves a song to a new position (1 = first). DJs only. */
  moveSong(guildId: string, playlistId: number, itemId: number, toPosition: number): void {
    const playlist = this.get(guildId, playlistId);
    if (!this.store.item(playlist.id, itemId)) throw new UserError("That song isn't in the playlist any more.");
    if (!Number.isInteger(toPosition) || toPosition < 1 || toPosition > playlist.songCount) {
      throw new UserError(`The new position must be from 1 to ${playlist.songCount}.`);
    }
    this.store.moveItem(playlist.id, itemId, toPosition);
    this.emit("change", guildId);
  }

  // ---------------------------------------------------------------------------------------------
  // Playing (DJs)
  // ---------------------------------------------------------------------------------------------

  /**
   * Queues a playlist's songs in order. "replace" stops the current song and empties the queue first;
   * "append" adds them to the end. The songs are queued as requested by whoever pressed Play.
   */
  async play(
    guildId: string,
    playlistId: number,
    mode: PlaylistPlayMode,
    request: VoiceRequest & { requestedBy: Requester },
  ): Promise<{ playlist: PlaylistSummary; result: AddManyResult }> {
    const playlist = this.get(guildId, playlistId);
    if (playlist.items.length === 0) throw new UserError(`"${playlist.name}" has no songs yet.`);

    const items = playlist.items.map((song): QueueItem => ({
      id: randomUUID(), // a new queue item each time; the same song can be queued twice
      source: song.source,
      title: song.title,
      author: song.author,
      durationMs: song.durationMs,
      isStream: song.isStream,
      thumbnail: song.thumbnail,
      requestedBy: request.requestedBy,
    }));
    const result = await this.players.addMany(guildId, items, request, mode);
    return { playlist, result };
  }

  // ---------------------------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------------------------

  /**
   * Checks a name for a new (or renamed) playlist and returns it tidied up: spaces trimmed, at most
   * MAX_PLAYLIST_NAME_LENGTH characters, and not already used in this server (ignoring upper/lower case).
   * `renaming` is the playlist being renamed, which may keep its own name (e.g. to change its capitals).
   */
  private checkNewName(guildId: string, name: string, { renaming }: { renaming?: number } = {}): string {
    const cleanName = name.trim().replace(/\s+/g, " ");
    if (cleanName === "") throw new UserError("Give the playlist a name.");
    if (cleanName.length > MAX_PLAYLIST_NAME_LENGTH) {
      throw new UserError(`Playlist names can be at most ${MAX_PLAYLIST_NAME_LENGTH} characters long.`);
    }
    const existing = this.store.findByName(guildId, cleanName);
    if (existing && existing.id !== renaming) throw new UserError(`There's already a playlist called "${existing.name}".`);
    return cleanName;
  }

  /** `title` shortened to fit, with " (2)", " (3)"... added if a playlist already has that name. */
  private freeNameLike(guildId: string, title: string): string {
    const base = title.trim().replace(/\s+/g, " ").slice(0, MAX_PLAYLIST_NAME_LENGTH - 5) || "Imported playlist";
    let name = base;
    for (let number = 2; this.store.findByName(guildId, name); number++) name = `${base} (${number})`;
    return name;
  }

  /** How many more songs fit in a playlist. Throws if it's full. */
  private checkRoom(playlist: PlaylistSummary): number {
    const room = MAX_PLAYLIST_SONGS - playlist.songCount;
    if (room <= 0) throw new UserError(`"${playlist.name}" is full (at most ${MAX_PLAYLIST_SONGS} songs).`);
    return room;
  }

  /** Reads up to `limit` songs from a YouTube playlist link. */
  private readPlaylistLink(url: string, limit: number): Promise<{ title: string; entries: PlaylistEntry[] }> {
    const source = parseInput(url);
    if (!isYoutubePlaylistLink(source.url)) {
      throw new UserError(`That isn't a YouTube playlist link (one with "list=" in it).`);
    }
    return listPlaylist(source.url, limit);
  }
}

function toNewItem({ source, meta }: PlaylistEntry, addedBy: AddedBy): NewPlaylistItem {
  return { source, ...meta, addedBy: { id: addedBy.id, name: addedBy.name }, addedAt: Date.now() };
}
