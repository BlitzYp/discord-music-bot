import { type FormEvent, useState } from "react";
import * as api from "../api";
import { isYoutubePlaylistLink } from "../shared";
import { useAction } from "../useAction";

/** "Add a song": paste a link, the same as /play in Discord. Only shown to DJs. */
export function AddSong({ guildId }: { guildId: string }) {
  const [link, setLink] = useState("");
  /** For a link from a YouTube playlist: queue every song of the playlist instead of just this one. */
  const [wholePlaylist, setWholePlaylist] = useState(false);
  const { run, pending, error } = useAction();
  const isPlaylistLink = isYoutubePlaylistLink(link);

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
    <section className="card">
      <form className="add-song" onSubmit={submit}>
        <input
          type="url"
          placeholder="Paste a YouTube, SoundCloud or other link…"
          aria-label="Link to add"
          value={link}
          onChange={(event) => setLink(event.target.value)}
          disabled={pending}
        />
        <button type="submit" disabled={pending || !link.trim()}>
          {pending ? "Adding…" : "Add"}
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
      <p className="muted hint">
        {pending ? "Loading the link (can take ~10 seconds if yt-dlp has to download it)…" : "If the bot isn't in voice yet, it joins the channel you're in."}
      </p>
      {error && <p className="hint error-text">{error}</p>}
    </section>
  );
}
