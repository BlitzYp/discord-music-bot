import type { TrackSource } from "../shared";

interface Props {
  title: string;
  source: TrackSource;
  className?: string;
}

/**
 * A song's title that opens the song's page (YouTube, SoundCloud...) in a new tab. Library files have no page,
 * so they're plain text. `draggable={false}`: in a row that can be dragged to reorder, dragging should move the
 * row, not the link.
 */
export function SongTitle({ title, source, className }: Props) {
  if (source.kind === "file") return <span className={className}>{title}</span>;
  return (
    <a className={className} href={source.url} target="_blank" rel="noreferrer" title={`Open ${title}`} draggable={false}>
      {title}
    </a>
  );
}
