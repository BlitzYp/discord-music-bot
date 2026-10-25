import { type FormEvent, useEffect, useState } from "react";
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
  /** How many songs are playing or queued right now: "Play" asks before replacing them, "Save the queue" needs some. */
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
            No playlists yet.{canControl ? " Create one below, or import one from YouTube." : " A DJ can create one."}
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
        {canControl && <NewPlaylistForm guildId={guildId} queuedSongs={queuedSongs} onCreated={setSelectedId} />}
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
  queuedSongs: number;
  /** Opens the new playlist. */
  onCreated: (playlistId: number) => void;
}

/** DJs: create an empty playlist, import one from YouTube, or save the queue as one. */
function NewPlaylistForm({ guildId, queuedSongs, onCreated }: NewPlaylistFormProps) {
  const [name, setName] = useState("");
  const [importLink, setImportLink] = useState("");
  const { run, pending, error } = useAction();
  const isImport = importLink.trim() !== "";

  async function submit(event: FormEvent) {
    event.preventDefault();
    await run(async () => {
      const created = isImport
        ? await api.importPlaylist(guildId, importLink, name.trim() || undefined)
        : await api.createPlaylist(guildId, name);
      setName("");
      setImportLink("");
      onCreated(created.id);
    });
  }

  async function saveQueue() {
    const queueName = prompt("Name for the new playlist (it gets the current song and the whole queue):");
    if (!queueName?.trim()) return;
    await run(async () => onCreated((await api.saveQueueAsPlaylist(guildId, queueName)).id));
  }

  return (
    <form className="new-playlist" onSubmit={submit}>
      <h4>New playlist</h4>
      <div className="add-song">
        <input
          type="text"
          placeholder={isImport ? "Name (optional: uses the YouTube playlist's name)" : "Name"}
          aria-label="Playlist name"
          maxLength={MAX_PLAYLIST_NAME_LENGTH}
          value={name}
          onChange={(event) => setName(event.target.value)}
          disabled={pending}
        />
      </div>
      <div className="add-song">
        <input
          type="url"
          placeholder="Optional: a YouTube playlist link to import"
          aria-label="YouTube playlist link to import"
          value={importLink}
          onChange={(event) => setImportLink(event.target.value)}
          disabled={pending}
        />
        <button type="submit" disabled={pending || (!isImport && !name.trim())}>
          {pending ? "Working…" : isImport ? "Import" : "Create"}
        </button>
      </div>
      <p className="muted hint">
        {pending && isImport
          ? "Reading the YouTube playlist (a few seconds)…"
          : "Importing reads up to 500 songs; they're loaded only when they play."}
      </p>
      <p className="hint">
        <button type="button" className="small" disabled={pending || queuedSongs === 0} onClick={saveQueue}>
          Save the queue as a playlist
        </button>
      </p>
      {error && <p className="hint error-text">{error}</p>}
    </form>
  );
}
