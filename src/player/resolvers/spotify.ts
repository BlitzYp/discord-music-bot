import type { SpotifyLink } from "../../shared/spotify.js";
import { UserError } from "../errors.js";

/**
 * Reading Spotify links. Spotify doesn't let anyone stream its audio, so the bot only reads which songs a link
 * points to (title, artists, length) and then plays each one from YouTube (see `findSong` in ./index.ts).
 *
 * The songs are read from Spotify's embed page (`open.spotify.com/embed/...`, the player other websites show),
 * which works without an account or API keys. The page carries its data as JSON in a `__NEXT_DATA__` script tag.
 * That's not an official API: if Spotify changes the page, this file is the one to fix.
 */

/** A song as Spotify describes it. */
export interface SpotifySong {
  title: string;
  artists: string[];
  durationMs?: number;
}

/** An album or playlist: its name and songs. */
export interface SpotifyCollection {
  title: string;
  songs: SpotifySong[];
}

/** The embed page lists at most this many songs of a playlist or album; longer ones are cut off there. */
export const SPOTIFY_EMBED_SONG_LIMIT = 100;

/** How long to wait for Spotify before giving up. */
const FETCH_TIMEOUT_MS = 10_000;

/** Reads the title, artists and length of a Spotify track link. */
export async function readSpotifyTrack(link: SpotifyLink): Promise<SpotifySong> {
  const entity = await fetchEmbedEntity(link);
  if (typeof entity.name !== "string" || !Array.isArray(entity.artists)) throw pageChangedError();
  return {
    title: entity.name,
    artists: entity.artists.map((artist: { name?: string }) => artist.name).filter(isText),
    durationMs: typeof entity.duration === "number" ? entity.duration : undefined,
  };
}

/** Reads the name and songs (at most SPOTIFY_EMBED_SONG_LIMIT) of a Spotify album or playlist link. */
export async function readSpotifyCollection(link: SpotifyLink): Promise<SpotifyCollection> {
  const entity = await fetchEmbedEntity(link);
  if (!Array.isArray(entity.trackList)) throw pageChangedError();

  const songs: SpotifySong[] = [];
  for (const track of entity.trackList) {
    // Podcast episodes in a playlist have no artists; they aren't on YouTube Music either, so they're skipped.
    if (track.entityType !== "track" || !isText(track.title)) continue;
    songs.push({
      title: track.title,
      // Here the artists come as one text, "Artist A, Artist B".
      artists: isText(track.subtitle) ? [track.subtitle] : [],
      durationMs: typeof track.duration === "number" ? track.duration : undefined,
    });
  }
  const fallbackTitle = link.type === "album" ? "Spotify album" : "Spotify playlist";
  return { title: isText(entity.name) ? entity.name : fallbackTitle, songs };
}

/** The words to search YouTube for to find a Spotify song: "Artist A, Artist B Title". */
export function searchQueryFor(song: SpotifySong): string {
  return `${song.artists.join(", ")} ${song.title}`.trim();
}

/**
 * Downloads the embed page of a link and returns the `entity` it describes (a track, album or playlist).
 * Spotify doesn't promise anything about this JSON, so it's `any` and the callers check each field they use.
 */
async function fetchEmbedEntity(link: SpotifyLink): Promise<any> {
  const url = `https://open.spotify.com/embed/${link.type}/${link.id}`;
  let response: Response;
  try {
    // A browser-like User-Agent: Spotify serves bots without one a page with less in it.
    response = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  } catch (error) {
    throw new UserError(`Couldn't reach Spotify (${error instanceof Error ? error.message : String(error)}). Try again in a moment.`);
  }
  if (!response.ok) throw new UserError(`Spotify answered with an error (${response.status}). Try again in a moment.`);

  const html = await response.text();
  const json = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/)?.[1];
  if (!json) throw pageChangedError();
  const pageProps = JSON.parse(json)?.props?.pageProps;
  // A wrong id (or a private playlist) still loads the page with HTTP 200, but with `status: 404` inside.
  if (pageProps?.status === 404) {
    const privateHint = link.type === "playlist" ? " If it's yours, make it public in Spotify." : "";
    throw new UserError(`Spotify says that ${link.type} doesn't exist.${privateHint}`);
  }
  const entity = pageProps?.state?.data?.entity;
  if (!entity) throw pageChangedError();
  return entity;
}

function isText(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

/** A new error each time, so each one has its own stack trace. */
const pageChangedError = () =>
  new Error("Spotify's embed page looks different than expected, so the songs couldn't be read (src/player/resolvers/spotify.ts needs updating).");
