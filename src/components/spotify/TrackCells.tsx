import { Icon } from "../ui/Icon";
import type { SpotifyTrack } from "./types";

const trackUrl = (track: SpotifyTrack) =>
  `https://open.spotify.com/track/${track.id}`;

/** Album art linking to Spotify, with a play overlay on hover. */
export function TrackCover({
  track,
  size,
}: {
  track: SpotifyTrack;
  size: "w-12 h-12" | "w-10 h-10";
}) {
  return (
    <a
      href={trackUrl(track)}
      target="_blank"
      rel="noopener noreferrer"
      className="shrink-0 group relative cursor-pointer"
      title="Åpne i Spotify"
    >
      {track.albumImageUrl ? (
        <img
          src={track.albumImageUrl}
          alt={track.albumName}
          className={`${size} rounded object-cover shadow-xs transition duration-300 group-hover:scale-105 group-hover:opacity-85`}
          loading="lazy"
        />
      ) : (
        <div
          className={`${size} bg-brand-title/5 rounded flex items-center justify-center ${size === "w-10 h-10" ? "shrink-0 " : ""}text-brand-title/30 transition duration-300 group-hover:scale-105`}
        >
          🎵
        </div>
      )}
      <div className="absolute inset-0 bg-black/45 rounded opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex items-center justify-center">
        <Icon
          name="play"
          className="w-4 h-4 text-white fill-current"
          title="Spill av"
        />
      </div>
    </a>
  );
}

/** Track name (linked) + artists. */
export function TrackTitle({
  track,
  titleClass = "",
}: {
  track: SpotifyTrack;
  titleClass?: string;
}) {
  return (
    <div className="min-w-0">
      <a
        href={trackUrl(track)}
        target="_blank"
        rel="noopener noreferrer"
        className={`font-serif font-semibold ${titleClass}text-brand-title hover:underline truncate block`}
        title="Åpne i Spotify"
      >
        {track.name}
      </a>
      <p className="text-xs text-brand-text/75 truncate">{track.artists}</p>
    </div>
  );
}
