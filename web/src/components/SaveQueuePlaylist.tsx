import { type FormEvent, useEffect, useId, useRef, useState } from "react";
import * as api from "../api";
import { MAX_PLAYLIST_NAME_LENGTH, type PlaylistDetails } from "../shared";
import { useAction } from "../useAction";

interface Props {
  id: string;
  guildId: string;
  /** Includes the current song as well as those waiting in the queue. */
  songCount: number;
  hasCurrentTrack: boolean;
  onCancel: () => void;
  onSaved: (playlist: PlaylistDetails) => void;
}

/** An inline name form beside the queue, using the same DJ-only save route as before. */
export function SaveQueuePlaylist({ id, guildId, songCount, hasCurrentTrack, onCancel, onSaved }: Props) {
  const nameId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const { run, pending, error } = useAction();

  useEffect(() => inputRef.current?.focus(), []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending || !name.trim() || songCount === 0) return;
    await run(async () => onSaved(await api.saveQueueAsPlaylist(guildId, name.trim())));
  }

  return (
    <form id={id} className="queue-save-form" onSubmit={submit}>
      <div>
        <label className="field-label" htmlFor={nameId}>Save the queue as a playlist</label>
        <p id={`${nameId}-hint`} className="muted hint">
          Saves {songCount} {songCount === 1 ? "song" : "songs"}{hasCurrentTrack ? ", including the current song" : " from the queue"}. Playback continues.
        </p>
      </div>
      <div className="playlist-name-row">
        <input
          ref={inputRef}
          id={nameId}
          type="text"
          placeholder="Playlist name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={MAX_PLAYLIST_NAME_LENGTH}
          required
          disabled={pending}
          aria-describedby={`${nameId}-hint`}
        />
        <button type="submit" className="primary" disabled={pending || !name.trim() || songCount === 0}>
          {pending ? "Saving…" : "Save playlist"}
        </button>
        <button type="button" disabled={pending} onClick={onCancel}>Cancel</button>
      </div>
      {songCount === 0 && <p className="muted hint">Add a song to the queue before saving.</p>}
      {error && <p className="hint error-text" role="alert">{error}</p>}
    </form>
  );
}
