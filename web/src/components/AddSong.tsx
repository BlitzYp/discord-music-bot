import { type FormEvent, useState } from "react";
import * as api from "../api";
import { useAction } from "../useAction";

/** "Add a song": paste a link, the same as /play in Discord. Only shown to DJs. */
export function AddSong({ guildId }: { guildId: string }) {
  const [link, setLink] = useState("");
  const { run, pending, error } = useAction();

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!link.trim()) return;
    await run(async () => {
      await api.addToQueue(guildId, link);
      setLink(""); // only cleared when it worked, so a typo can be fixed
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
      <p className="muted hint">
        {pending ? "Loading the link (can take ~10 seconds if yt-dlp has to download it)…" : "If the bot isn't in voice yet, it joins the channel you're in."}
      </p>
      {error && <p className="hint error-text">{error}</p>}
    </section>
  );
}
