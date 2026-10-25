import type { LavalinkManager, Track } from "lavalink-client";
import type { Requester } from "../../shared/types.js";
import { UserError } from "../errors.js";

/** Loads a URL through Lavalink and returns the single track it points to. */
export async function loadWithLavalink(lavalink: LavalinkManager, url: string, requester: Requester): Promise<Track> {
  const node = lavalink.nodeManager.leastUsedNodes()[0];
  if (!node?.connected) throw new UserError("The audio server (Lavalink) isn't connected right now. Try again in a moment.");

  const result = await node.search({ query: url }, requester);
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
