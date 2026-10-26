import type { LavalinkManager, SearchQuery, Track } from "lavalink-client";
import type { Requester } from "../../shared/types.js";
import { UserError } from "../errors.js";

/** Loads a URL through Lavalink and returns the single track it points to. */
export function loadUrlWithLavalink(lavalink: LavalinkManager, url: string, requester: Requester): Promise<Track> {
  return load(lavalink, { query: url }, requester);
}

/**
 * Searches YouTube through Lavalink's YouTube plugin and returns the best match. YouTube Music is asked first,
 * because it finds the song itself (album audio) rather than a music video with an intro or a skit in it; plain
 * YouTube is asked when YouTube Music finds nothing (talks, mixes, things that aren't songs).
 */
export async function searchWithLavalink(lavalink: LavalinkManager, query: string, requester: Requester): Promise<Track> {
  for (const source of ["ytmsearch", "ytsearch"] as const) {
    const track = await load(lavalink, { query, source }, requester).catch((error: unknown) => {
      // Nothing found is worth asking the other search; any other failure (Lavalink down, YouTube blocking) isn't.
      if (error instanceof UserError && error.message === NOTHING_FOUND) return null;
      throw error;
    });
    if (track) return track;
  }
  throw new UserError(`Nothing was found on YouTube for "${query}".`);
}

/** Loads an audio file on this machine through Lavalink's local source. */
export function loadFileWithLavalink(lavalink: LavalinkManager, path: string, requester: Requester): Promise<Track> {
  // Without `source: "local"`, lavalink-client would treat the path as a YouTube search.
  return load(lavalink, { query: path, source: "local" }, requester);
}

const NOTHING_FOUND = "Nothing playable was found at that link.";

async function load(lavalink: LavalinkManager, query: SearchQuery, requester: Requester): Promise<Track> {
  const node = lavalink.nodeManager.leastUsedNodes()[0];
  if (!node?.connected) throw new UserError("The audio server (Lavalink) isn't connected right now. Try again in a moment.");

  const result = await node.search(query, requester);
  switch (result.loadType) {
    case "track":
    case "search": {
      const track = result.tracks[0];
      if (track) return track;
      break;
    }
    case "playlist": {
      // Playlist expansion comes later; for now play the selected (or first) video of the playlist link.
      const track = result.playlist?.selectedTrack ?? result.tracks[0];
      if (track) return track;
      break;
    }
    case "error":
      throw new UserError(`Couldn't load that link: ${result.exception?.message ?? "unknown error"}`);
    case "empty":
      break;
  }
  throw new UserError(NOTHING_FOUND);
}
