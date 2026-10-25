import { type FormEvent, useEffect, useState } from "react";
import * as api from "../api";
import { describeAddMany, formatDuration, isYoutubePlaylistLink, type PlaylistDetails, type PlaylistPlayMode } from "../shared";
import { useAction } from "../useAction";
import { useDragReorder } from "../useDragReorder";
import { SongTitle } from "./SongTitle";

interface Props {
  guildId: string;
  playlistId: number;
  userId: string;
  canControl: boolean;
  queuedSongs: number;
  /** Goes up when the bot says a playlist changed; the songs are loaded again then. */
  changeCount: number;
  onDeleted: () => void;
}

/** One playlist: its songs, adding songs (everyone), and playing, renaming, reordering and deleting (DJs). */
export function PlaylistView({ guildId, playlistId, userId, canControl, queuedSongs, changeCount, onDeleted }: Props) {
  const [playlist, setPlaylist] = useState<PlaylistDetails | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  /** What the last Play / Add to queue did, e.g. "Queued 12 songs." */
  const [playResult, setPlayResult] = useState<string | null>(null);
  const { run, pending, error } = useAction();
  const { rowProps } = useDragReorder(
    playlist?.items ?? [],
    (song, position) => run(() => api.moveInPlaylist(guildId, playlistId, song.id, position)),
    { enabled: canControl && !pending },
  );

  useEffect(() => {
    api
      .fetchPlaylist(guildId, playlistId)
      .then((details) => {
        setPlaylist(details);
        setLoadError(null);
      })
      .catch((err: Error) => setLoadError(err.message));
  }, [guildId, playlistId, changeCount]);

  if (loadError) return <p className="banner error">{loadError}</p>;
  if (!playlist) return <p className="muted">Loading…</p>;

  function play(mode: PlaylistPlayMode) {
    // Replacing can't be undone, so ask first when something is queued.
    if (mode === "replace" && queuedSongs > 0) {
      const what = queuedSongs === 1 ? "the current song" : `the current song and the queue (${queuedSongs} songs)`;
      if (!confirm(`Play "${playlist!.name}"? This stops ${what} and replaces them.`)) return;
    }
    setPlayResult(null);
    void run(async () => {
      const { result } = await api.playPlaylist(guildId, playlistId, mode);
      setPlayResult(describeAddMany(result));
    });
  }

  function rename() {
    const name = prompt("New name for the playlist:", playlist!.name);
    if (name?.trim() && name.trim() !== playlist!.name) void run(() => api.renamePlaylist(guildId, playlistId, name));
  }

  function remove() {
    if (!confirm(`Delete the playlist "${playlist!.name}" and its ${playlist!.songCount} songs? This can't be undone.`)) return;
    void run(async () => {
      await api.deletePlaylist(guildId, playlistId);
      onDeleted();
    });
  }

  const songs = playlist.items;

  return (
    <section className="card">
      <h3 className="with-action">
        <span>
          {playlist.name}{" "}
          <span className="muted">
            · {playlist.songCount} {playlist.songCount === 1 ? "song" : "songs"} · {formatDuration(playlist.totalDurationMs)} · made by{" "}
            {playlist.createdBy.name}
          </span>
        </span>
        {canControl && (
          <span className="row-actions">
            <button type="button" className="small" disabled={pending} onClick={rename}>
              ✏️ Rename
            </button>
            <button type="button" className="small" disabled={pending} onClick={remove}>
              🗑 Delete
            </button>
          </span>
        )}
      </h3>

      {canControl && (
        <div className="playlist-actions">
          <button type="button" disabled={pending || songs.length === 0} onClick={() => play("replace")}>
            ▶ Play
          </button>
          <button type="button" disabled={pending || songs.length === 0} onClick={() => play("append")}>
            ➕ Add to queue
          </button>
          <span className="muted hint">Play replaces the queue. The bot joins your voice channel if it isn't in one.</span>
        </div>
      )}
      {playResult && <p className="hint">{playResult}</p>}

      <AddToPlaylist guildId={guildId} playlistId={playlistId} canImport={canControl} />

      {songs.length === 0 ? (
        <p className="muted">No songs yet.</p>
      ) : (
        <ol className="queue">
          {songs.map((song, index) => {
            const position = index + 1;
            // Members may remove the songs they added; the bot checks this again.
            const canRemove = canControl || song.addedBy.id === userId;
            return (
              <li key={song.id} {...rowProps(song, index)}>
                <span className="position">{position}</span>
                {song.thumbnail ? <img src={song.thumbnail} alt="" draggable={false} /> : <span className="thumb placeholder">♪</span>}
                <span className="info">
                  <SongTitle className="title" title={song.title} source={song.source} />
                  <span className="muted">
                    {song.author ? `${song.author} · ` : ""}added by {song.addedBy.name}
                  </span>
                </span>
                <span className="duration">{formatDuration(song.durationMs, song.isStream)}</span>
                {(canControl || canRemove) && (
                  <span className="row-actions">
                    {canControl && (
                      <>
                        <button
                          type="button"
                          title="Move up"
                          aria-label={`Move ${song.title} up`}
                          disabled={pending || position === 1}
                          onClick={() => run(() => api.moveInPlaylist(guildId, playlistId, song.id, position - 1))}
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          title="Move down"
                          aria-label={`Move ${song.title} down`}
                          disabled={pending || position === songs.length}
                          onClick={() => run(() => api.moveInPlaylist(guildId, playlistId, song.id, position + 1))}
                        >
                          ↓
                        </button>
                      </>
                    )}
                    {canRemove && (
                      <button
                        type="button"
                        title="Remove from the playlist"
                        aria-label={`Remove ${song.title}`}
                        disabled={pending}
                        onClick={() => run(() => api.removeFromPlaylist(guildId, playlistId, song.id))}
                      >
                        ✕
                      </button>
                    )}
                  </span>
                )}
              </li>
            );
          })}
        </ol>
      )}
      {error && <p className="hint error-text">{error}</p>}
    </section>
  );
}

interface AddToPlaylistProps {
  guildId: string;
  playlistId: number;
  /** DJs may add every song of a YouTube playlist at once. */
  canImport: boolean;
}

/** Adds a link to the playlist (anyone), or, for DJs, every song of a YouTube playlist link. */
function AddToPlaylist({ guildId, playlistId, canImport }: AddToPlaylistProps) {
  const [link, setLink] = useState("");
  const [wholePlaylist, setWholePlaylist] = useState(false);
  const { run, pending, error } = useAction();
  const offerImport = canImport && isYoutubePlaylistLink(link);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!link.trim()) return;
    await run(async () => {
      if (offerImport && wholePlaylist) await api.importIntoPlaylist(guildId, playlistId, link);
      else await api.addToPlaylist(guildId, playlistId, link);
      setLink("");
      setWholePlaylist(false);
    });
  }

  return (
    <form className="add-to-playlist" onSubmit={submit}>
      <div className="add-song">
        <input
          type="url"
          placeholder="Add a song: paste a YouTube, SoundCloud or other link…"
          aria-label="Link to add to the playlist"
          value={link}
          onChange={(event) => setLink(event.target.value)}
          disabled={pending}
        />
        <button type="submit" disabled={pending || !link.trim()}>
          {pending ? "Adding…" : "Add"}
        </button>
      </div>
      {offerImport && (
        <label className="checkbox hint">
          <input type="checkbox" checked={wholePlaylist} onChange={(event) => setWholePlaylist(event.target.checked)} disabled={pending} />
          This link is from a YouTube playlist: add all of its songs
        </label>
      )}
      {error && <p className="hint error-text">{error}</p>}
    </form>
  );
}
