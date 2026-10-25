import { useState } from "react";

interface Props {
  src?: string;
  className: "artwork" | "thumb";
}

/** Artwork is decorative. Keep its space and show a quiet fallback if the source image fails to load. */
export function TrackArtwork({ src, className }: Props) {
  const [failedSource, setFailedSource] = useState<string | null>(null);

  return (
    <span className={`track-artwork ${className}`} aria-hidden="true">
      {src && src !== failedSource ? (
        <img
          src={src}
          alt=""
          draggable={false}
          loading={className === "artwork" ? "eager" : "lazy"}
          onError={() => setFailedSource(src)}
        />
      ) : (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" focusable="false">
          <path d="M9 17V6l11-2v11M9 9l11-2" strokeLinecap="round" strokeLinejoin="round" />
          <ellipse cx="6" cy="17" rx="3" ry="2.5" />
          <ellipse cx="17" cy="15" rx="3" ry="2.5" />
        </svg>
      )}
    </span>
  );
}
