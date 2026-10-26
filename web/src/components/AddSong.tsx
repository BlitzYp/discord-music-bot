import { type FormEvent, useId, useState } from "react";
import * as api from "../api";
import { isSpotifyCollectionLink, isYoutubePlaylistLink } from "../shared";
import { useAction } from "../useAction";

/** "Add a song": search for a song or paste a link, the same as /play in Discord. Only shown to DJs. */
export function AddSong({ guildId }: { guildId: string }) {
  const linkId = useId();
  const [link, setLink] = useState("");
  /** For a link from a YouTube playlist: queue every song of the playlist instead of just this one. */
  const [wholePlaylist, setWholePlaylist] = useState(false);
  const { run, pending, error } = useAction();
  const isPlaylistLink = isYoutubePlaylistLink(link);
  // Spotify albums and playlists always add all of their songs (the server decides that, not a checkbox).
  const isSpotifyCollection = isSpotifyCollectionLink(link);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!link.trim()) return;
    await run(async () => {
      if (isPlaylistLink && wholePlaylist) await api.addWholePlaylistToQueue(guildId, link);
      else await api.addToQueue(guildId, link);
      setLink(""); // only cleared when it worked, so a typo can be fixed
      setWholePlaylist(false);
    });
  }

  return (
    <div className="queue-add-song">
      <label className="visually-hidden" htmlFor={linkId}>Add a song</label>
      <form className="add-song" onSubmit={submit}>
        <input
          id={linkId}
          type="text"
          placeholder="Search for a song, or paste a link…"
          value={link}
          onChange={(event) => setLink(event.target.value)}
          disabled={pending}
        />
        <button type="submit" className="primary" disabled={pending || !link.trim()}>
          {pending ? "Adding…" : "Add to queue"}
        </button>
      </form>
      {isPlaylistLink && (
        <label className="checkbox hint">
          <input
            type="checkbox"
            checked={wholePlaylist}
            onChange={(event) => setWholePlaylist(event.target.checked)}
            disabled={pending}
          />
          This link is from a YouTube playlist: add all of its songs (up to 500)
        </label>
      )}
      {isSpotifyCollection && (
        <p className="hint">This is a Spotify album or playlist: all of its songs are looked up on YouTube and added.</p>
      )}
      <p className="muted hint">
        {pending
          ? isSpotifyCollection
            ? "Finding each song on YouTube. This can take up to half a minute…"
            : "Finding the song. This can take a few seconds…"
          : "Join a voice channel in Discord to start playing."}
      </p>
      {error && <p className="hint error-text">{error}</p>}
    </div>
  );
}
