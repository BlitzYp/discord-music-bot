import { type ChangeEvent, useEffect, useState } from "react";
import * as api from "../api";
import {
  formatBytes,
  formatDuration,
  hasLevel,
  type LibraryFile,
  type LibraryOverview,
  type PermissionLevel,
  UPLOAD_ACCEPT,
} from "../shared";
import { socket } from "../socket";
import { useAction } from "../useAction";
import { TrackArtwork } from "./TrackArtwork";

interface Props {
  guildId: string;
  /** The user's level in the server: uploading depends on the server's setting, deleting and queuing need a DJ. */
  level: PermissionLevel;
}

/**
 * The Library tab: audio files uploaded to the server. Everyone can browse and search; DJs can queue and delete
 * files; uploading follows the server's setting (DJs by default). The bot checks every change again.
 */
export function LibraryPage({ guildId, level }: Props) {
  const [overview, setOverview] = useState<LibraryOverview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  /** Goes up whenever the bot says the library changed (here, in Discord, or in someone else's browser). */
  const changeCount = useLibraryChanges(guildId);

  useEffect(() => {
    api
      .fetchLibrary(guildId)
      .then((next) => {
        setOverview(next);
        setLoadError(null);
      })
      .catch((err: Error) => setLoadError(err.message));
  }, [guildId, changeCount]);

  if (loadError) return <p className="banner error">Couldn't load the library: {loadError}</p>;
  if (!overview) return <p className="muted">Loading…</p>;

  const isDj = hasLevel(level, "dj");
  const canUpload = overview.uploadPermission !== "off" && hasLevel(level, overview.uploadPermission);
  const wanted = search.trim().toLowerCase();
  const shown = overview.files.filter((file) => matchesSearch(file, wanted));

  return (
    <main>
      <section className="card library">
        <div className="section-heading">
          <div>
            <h3>Library</h3>
            <p className="muted section-meta">
              {overview.files.length} {overview.files.length === 1 ? "file" : "files"} · {formatBytes(overview.usedBytes)} of{" "}
              {formatBytes(overview.quotaBytes)} used
            </p>
          </div>
        </div>

        {canUpload ? (
          <UploadForm guildId={guildId} overview={overview} />
        ) : (
          <p className="muted hint">{uploadHint(overview, level)}</p>
        )}

        {overview.files.length > 0 && (
          <input
            type="search"
            className="library-search"
            placeholder="Search by title, artist or file name"
            aria-label="Search the library"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        )}

        {overview.files.length === 0 && <p className="muted empty-queue">The library is empty.</p>}
        {overview.files.length > 0 && shown.length === 0 && <p className="muted empty-queue">No file matches “{search}”.</p>}
        {shown.length > 0 && <FileList guildId={guildId} files={shown} canControl={isDj} />}
      </section>
    </main>
  );
}

/** Why someone can't upload here. */
function uploadHint({ uploadPermission }: LibraryOverview, level: PermissionLevel): string {
  if (uploadPermission === "off") return "Uploads are turned off in this server. A server admin can turn them on in Settings.";
  if (uploadPermission === "admin") return "Only server admins can upload files here.";
  return "Only DJs can upload files here.";
}

function matchesSearch(file: LibraryFile, wanted: string): boolean {
  if (wanted === "") return true;
  return [file.title, file.artist ?? "", file.originalName].some((text) => text.toLowerCase().includes(wanted));
}

/** Counts the bot's `library:update` messages for this server, so the page knows when to reload. */
function useLibraryChanges(guildId: string): number {
  const [count, setCount] = useState(0);
  useEffect(() => {
    // The socket is already watching this server (see useGuildState), so these messages are about it.
    const onChange = () => setCount((previous) => previous + 1);
    socket.on("library:update", onChange);
    // After a reconnect, changes may have been missed; reload once.
    socket.on("connect", onChange);
    return () => {
      socket.off("library:update", onChange);
      socket.off("connect", onChange);
    };
  }, [guildId]);
  return count;
}

/** What the upload form is doing right now. */
interface UploadStatus {
  fileName: string;
  /** Which of the picked files this is (1-based), and how many were picked. */
  number: number;
  total: number;
  /** 0 to 1 while sending; 1 while the bot checks (and maybe converts) the file. */
  sent: number;
}

/** Picks one or more audio files and uploads them one after another, showing the progress. */
function UploadForm({ guildId, overview }: { guildId: string; overview: LibraryOverview }) {
  const [status, setStatus] = useState<UploadStatus | null>(null);
  /** One line per file that couldn't be added. */
  const [problems, setProblems] = useState<string[]>([]);
  const [added, setAdded] = useState(0);

  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const input = event.target;
    const files = [...(input.files ?? [])];
    input.value = ""; // so picking the same file again starts a new upload
    if (files.length === 0) return;

    setProblems([]);
    setAdded(0);
    for (const [index, file] of files.entries()) {
      // Checked here too, so a file that's too big isn't sent at all. The bot checks again.
      if (file.size > overview.maxUploadBytes) {
        setProblems((previous) => [
          ...previous,
          `${file.name}: ${formatBytes(file.size)} is too big (at most ${formatBytes(overview.maxUploadBytes)}).`,
        ]);
        continue;
      }
      const base = { fileName: file.name, number: index + 1, total: files.length };
      setStatus({ ...base, sent: 0 });
      try {
        await api.uploadToLibrary(guildId, file, (sent) => setStatus({ ...base, sent }));
        setAdded((previous) => previous + 1);
      } catch (err) {
        setProblems((previous) => [...previous, `${file.name}: ${(err as Error).message}`]);
      }
    }
    setStatus(null);
  }

  return (
    <div className="upload">
      <label className={`button upload-button ${status ? "disabled" : ""}`}>
        <input type="file" accept={UPLOAD_ACCEPT} multiple disabled={status !== null} onChange={upload} className="visually-hidden" />
        {status ? "Uploading…" : "Upload audio files"}
      </label>
      <p className="muted hint">
        Up to {formatBytes(overview.maxUploadBytes)} per file. MP3, FLAC, WAV, OGG, M4A and most other audio formats work;
        formats the bot can't play directly are converted.
      </p>
      {status && (
        <div className="upload-status" role="status">
          <span className="upload-name">
            {status.total > 1 ? `${status.number} of ${status.total}: ` : ""}
            {status.fileName}
          </span>
          {status.sent < 1 ? (
            <progress max={1} value={status.sent} aria-label="Upload progress" />
          ) : (
            <span className="muted">Checking the file…</span>
          )}
        </div>
      )}
      {added > 0 && !status && (
        <p className="hint muted">
          Added {added} {added === 1 ? "file" : "files"}.
        </p>
      )}
      {problems.map((problem) => (
        <p key={problem} className="hint error-text">
          {problem}
        </p>
      ))}
    </div>
  );
}

interface FileListProps {
  guildId: string;
  files: LibraryFile[];
  /** Whether the user is a DJ (shows add-to-queue and delete). */
  canControl: boolean;
}

function FileList({ guildId, files, canControl }: FileListProps) {
  const { run, pending, error } = useAction();

  function remove(file: LibraryFile) {
    if (confirm(`Delete “${file.title}” from the library? Copies already in the queue won't play.`)) {
      void run(() => api.deleteLibraryFile(guildId, file.id));
    }
  }

  return (
    <>
      <ol className="queue queue-scroll library-files" aria-label="Library files" tabIndex={0}>
        {files.map((file) => (
          <li key={file.id}>
            <TrackArtwork className="thumb" src={undefined} />
            <span className="info">
              <span className="title" title={file.originalName}>
                {file.title}
              </span>
              <span className="muted">
                {file.artist ? `${file.artist} · ` : ""}
                {file.uploadedBy.name} · {formatBytes(file.sizeBytes)}
              </span>
            </span>
            <span className="duration">{formatDuration(file.durationMs)}</span>
            {canControl && (
              <span className="row-actions">
                <button
                  type="button"
                  title="Add to queue"
                  aria-label={`Add ${file.title} to queue`}
                  disabled={pending}
                  onClick={() => run(() => api.addLibraryFileToQueue(guildId, file.id))}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true" focusable="false">
                    <path d="M12 5v14M5 12h14" strokeLinecap="round" />
                  </svg>
                </button>
                <button type="button" title="Delete" aria-label={`Delete ${file.title}`} disabled={pending} onClick={() => remove(file)}>
                  ✕
                </button>
              </span>
            )}
          </li>
        ))}
      </ol>
      {error && <p className="hint error-text">{error}</p>}
    </>
  );
}
