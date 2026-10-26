// Spotify links (added after milestone 9): recognising them. Shared so the website knows that an album or
// playlist link adds all of its songs. Reading what's behind a link is src/player/resolvers/spotify.ts.

export type SpotifyLinkType = "track" | "album" | "playlist";

export interface SpotifyLink {
  type: SpotifyLinkType;
  /** Spotify's id for the track, album or playlist: 22 letters and digits. */
  id: string;
}

const SPOTIFY_ID = /^[A-Za-z0-9]{22}$/;
const LINK_TYPES = new Set<string>(["track", "album", "playlist"]);

/**
 * Reads a Spotify link: `https://open.spotify.com/track/<id>?si=...` (also with `/intl-de/` or `/embed/` in
 * front, which Spotify adds for other countries and for embeds) or a `spotify:track:<id>` URI from the app.
 * Returns null for anything else, including Spotify links the bot can't play (artists, podcasts).
 */
export function parseSpotifyLink(input: string): SpotifyLink | null {
  const text = input.trim();
  if (text.startsWith("spotify:")) {
    const [, type, id] = text.split(":");
    return toLink(type, id);
  }

  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (url.hostname !== "open.spotify.com") return null;
  // ["intl-de", "track", "<id>"] → keep the last two parts.
  const parts = url.pathname.split("/").filter((part) => part !== "" && !part.startsWith("intl-") && part !== "embed");
  return toLink(parts[0], parts[1]);
}

function toLink(type: string | undefined, id: string | undefined): SpotifyLink | null {
  if (!type || !id || !LINK_TYPES.has(type) || !SPOTIFY_ID.test(id)) return null;
  return { type: type as SpotifyLinkType, id };
}

/** Whether the input is a Spotify album or playlist link, which always adds all of its songs. */
export function isSpotifyCollectionLink(input: string): boolean {
  const link = parseSpotifyLink(input);
  return link !== null && link.type !== "track";
}

/**
 * Whether the input is a `spotify.link/...` short link (from the app's Share menu). The bot doesn't follow those:
 * it can't tell whether they're a song or a playlist before loading them.
 */
export function isSpotifyShortLink(input: string): boolean {
  try {
    return new URL(input.trim()).hostname === "spotify.link";
  } catch {
    return false;
  }
}
