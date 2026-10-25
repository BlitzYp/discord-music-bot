import type { LavalinkManager, SearchQuery, Track } from "lavalink-client";
import type { Requester } from "../../shared/types.js";
import { UserError } from "../errors.js";

/** Loads a URL through Lavalink and returns the single track it points to. */
export function loadUrlWithLavalink(lavalink: LavalinkManager, url: string, requester: Requester): Promise<Track> {
  return load(lavalink, { query: url }, requester);
}

/** Loads an audio file on this machine through Lavalink's local source. */
export function loadFileWithLavalink(lavalink: LavalinkManager, path: string, requester: Requester): Promise<Track> {
  // Without `source: "local"`, lavalink-client would treat the path as a YouTube search.
  return load(lavalink, { query: path, source: "local" }, requester);
}

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
  throw new UserError("Nothing playable was found at that link.");
}
