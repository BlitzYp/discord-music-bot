import { type FormEvent, useEffect, useId, useState } from "react";
import * as api from "../api";
import { formatDuration, MAX_PLAYLIST_NAME_LENGTH, type PlaylistSummary } from "../shared";
import { socket } from "../socket";
import { useAction } from "../useAction";
import { PlaylistView } from "./PlaylistView";

interface Props {
  guildId: string;
  /** The logged-in user's id: members may remove the songs they added themselves. */
  userId: string;
  /** Whether the user is a DJ (create, import, play, rename, delete, reorder). */
  canControl: boolean;
  /** How many songs are playing or queued right now: "Play" asks before replacing them. */
  queuedSongs: number;
}

/**
 * The Playlists tab: the server's saved playlists, and the songs of the one picked. Everyone can look and add
 * songs; DJs can do the rest. The bot checks every change again.
 */
export function PlaylistsPage({ guildId, userId, canControl, queuedSongs }: Props) {
  const [playlists, setPlaylists] = useState<PlaylistSummary[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  /** Goes up whenever the bot says a playlist changed (here, in Discord, or in someone else's browser). */
  const changeCount = usePlaylistChanges(guildId);

  useEffect(() => {
    api
      .fetchPlaylists(guildId)
      .then((list) => {
        setPlaylists(list);
        setLoadError(null);
      })
      .catch((err: Error) => setLoadError(err.message));
  }, [guildId, changeCount]);

  // A different server has different playlists.
  useEffect(() => setSelectedId(null), [guildId]);

  if (loadError) return <p className="banner error">Couldn't load the playlists: {loadError}</p>;
  if (!playlists) return <p className="muted">Loading…</p>;

  const selectedStillExists = playlists.some((p) => p.id === selectedId);

  return (
    <main>
      <section className="card">
        <h3>Playlists</h3>
        {playlists.length === 0 ? (
          <p className="muted">
            No playlists yet.{canControl ? " Create one below, or import one from YouTube or Spotify." : " A DJ can create one."}
          </p>
        ) : (
          <ul className="playlists">
            {playlists.map((playlist) => (
              <li key={playlist.id}>
                <button
                  type="button"
                  className={playlist.id === selectedId ? "active" : ""}
                  onClick={() => setSelectedId(playlist.id === selectedId ? null : playlist.id)}
                >
                  <span className="title">{playlist.name}</span>
                  <span className="muted">
                    {playlist.songCount} {playlist.songCount === 1 ? "song" : "songs"} · {formatDuration(playlist.totalDurationMs)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {canControl && <NewPlaylistForm key={guildId} guildId={guildId} onCreated={setSelectedId} />}
      </section>

      {selectedId !== null && selectedStillExists && (
        <PlaylistView
          key={selectedId}
          guildId={guildId}
          playlistId={selectedId}
          userId={userId}
          canControl={canControl}
          queuedSongs={queuedSongs}
          changeCount={changeCount}
          onDeleted={() => setSelectedId(null)}
        />
      )}
    </main>
  );
}

/** Counts the bot's `playlists:update` messages for this server, so the page knows when to reload. */
function usePlaylistChanges(guildId: string): number {
  const [count, setCount] = useState(0);
  useEffect(() => {
    // The socket is already watching this server (see useGuildState), so these messages are about it.
    const onChange = () => setCount((previous) => previous + 1);
    socket.on("playlists:update", onChange);
    // After a reconnect, changes may have been missed; reload once.
    socket.on("connect", onChange);
    return () => {
      socket.off("playlists:update", onChange);
      socket.off("connect", onChange);
    };
  }, [guildId]);
  return count;
}

interface NewPlaylistFormProps {
  guildId: string;
  /** Opens the new playlist. */
  onCreated: (playlistId: number) => void;
}

/** DJs can create an empty playlist, or reveal the optional import form. */
function NewPlaylistForm({ guildId, onCreated }: NewPlaylistFormProps) {
  const formId = useId();
  const [name, setName] = useState("");
  const [importLink, setImportLink] = useState("");
  const [importExpanded, setImportExpanded] = useState(false);
  const { run, pending, error } = useAction();
  const canSubmit = importExpanded ? Boolean(importLink.trim()) : Boolean(name.trim());

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending || !canSubmit) return;
    await run(async () => {
      const created = importExpanded
        ? await api.importPlaylist(guildId, importLink.trim(), name.trim() || undefined)
        : await api.createPlaylist(guildId, name.trim());
      setName("");
      setImportLink("");
      setImportExpanded(false);
      onCreated(created.id);
    });
  }

  return (
    <form className="new-playlist playlist-create" onSubmit={submit}>
      <div className="playlist-create-heading">
        <h4>New playlist</h4>
        <p className="muted hint">Give your next collection a name.</p>
      </div>
      <label className="field-label" htmlFor={`${formId}-name`}>
        Playlist name {importExpanded && <span className="muted">(optional)</span>}
      </label>
      <div className="playlist-name-row">
        <input
          id={`${formId}-name`}
          type="text"
          placeholder="e.g. Late-night favorites"
          maxLength={MAX_PLAYLIST_NAME_LENGTH}
          value={name}
          onChange={(event) => setName(event.target.value)}
          disabled={pending}
          required={!importExpanded}
          aria-describedby={importExpanded ? `${formId}-name-hint` : undefined}
        />
        <button type="submit" className="primary" disabled={pending || !canSubmit}>
          {pending ? (importExpanded ? "Importing…" : "Creating…") : importExpanded ? "Import playlist" : "Create playlist"}
        </button>
      </div>
      {importExpanded && <p id={`${formId}-name-hint`} className="muted hint">Leave the name blank to use the linked playlist's name.</p>}
      <button
        type="button"
        className="playlist-import-toggle"
        aria-expanded={importExpanded}
        aria-controls={`${formId}-import`}
        disabled={pending}
        onClick={() => setImportExpanded(!importExpanded)}
      >
        <span aria-hidden="true">{importExpanded ? "−" : "+"}</span>
        Import from YouTube or Spotify
      </button>
      <div id={`${formId}-import`} className="playlist-import-fields" hidden={!importExpanded}>
        <label className="field-label" htmlFor={`${formId}-link`}>Playlist or album link</label>
        <input
          id={`${formId}-link`}
          type="url"
          placeholder="Paste a YouTube playlist or Spotify link"
          value={importLink}
          onChange={(event) => setImportLink(event.target.value)}
          disabled={pending || !importExpanded}
          required={importExpanded}
          aria-describedby={`${formId}-import-hint`}
        />
        <p id={`${formId}-import-hint`} className="muted hint">
          YouTube: up to 500 songs. Spotify: up to 100. Songs load when played.
        </p>
      </div>
      {pending && importExpanded && <p className="muted hint" role="status">Reading the playlist. Spotify imports can take a little longer.</p>}
      {error && <p className="hint error-text" role="alert">{error}</p>}
    </form>
  );
}
