import { useRef } from "react";
import { useFlipGrid } from "../gallery/useFlipGrid";
import { TrackCover, TrackTitle } from "./TrackCells";
import type { SpotifyTrack } from "./types";

interface Props {
  tracks: SpotifyTrack[];
  isLoading: boolean;
  justAddedId?: string | null;
}

export function PlaylistTable({ tracks, isLoading, justAddedId }: Props) {
  const tbodyRef = useRef<HTMLTableSectionElement>(null);
  const orderKey = tracks.map((t) => t.id).join("|");
  useFlipGrid(tbodyRef, orderKey);

  if (isLoading) {
    return (
      <div className="space-y-3 max-w-4xl mx-auto">
        {[1, 2, 3].map((n) => (
          <div
            key={n}
            className="flex items-center justify-between p-4 bg-brand-bg/20 rounded-xl border border-brand-title/5 animate-pulse"
          >
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-brand-title/5 rounded" />
              <div className="space-y-2">
                <div className="h-4 w-36 bg-brand-title/10 rounded" />
                <div className="h-3 w-24 bg-brand-title/5 rounded" />
              </div>
            </div>
            <div className="h-4 w-28 bg-brand-title/5 rounded hidden md:block" />
          </div>
        ))}
      </div>
    );
  }

  if (tracks.length === 0) {
    return (
      <div className="text-center py-12 bg-brand-bg/10 rounded-2xl border border-dashed border-brand-title/20 max-w-4xl mx-auto">
        <span className="text-3xl">💿</span>
        <p className="text-body-serif text-brand-title/80 mt-3">
          Ingen sanger er foreslått enda.
        </p>
        <p className="text-caption mt-1">
          Vær den første til å foreslå en sang ved å søke over!
        </p>
      </div>
    );
  }

  return (
    <div className="bg-[#fcfbf9]/60 border border-brand-title/10 rounded-2xl overflow-hidden shadow-md max-w-4xl mx-auto motion-safe:animate-fade-in">
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-brand-title/15 text-xs uppercase tracking-widest text-brand-title/70 bg-brand-title/2">
              <th className="py-4 px-6 w-16">#</th>
              <th className="py-4 px-4">Tittel</th>
              <th className="py-4 px-6 hidden md:table-cell">Album</th>
            </tr>
          </thead>
          <tbody ref={tbodyRef} className="divide-y divide-brand-title/5">
            {tracks.map((track, idx) => (
              <tr
                key={track.id}
                data-flip-id={track.id}
                className={`hover:bg-brand-title/1 transition duration-150 text-sm ${
                  track.id === justAddedId ? "motion-safe:animate-pop" : ""
                }`}
              >
                <td className="py-3.5 px-6 text-brand-text/50 font-medium">
                  {idx + 1}
                </td>
                <td className="py-3.5 px-4 font-sans">
                  <div className="flex items-center gap-4">
                    <TrackCover track={track} size="w-10 h-10" />
                    <TrackTitle track={track} />
                  </div>
                </td>
                <td className="py-3.5 px-6 hidden md:table-cell text-brand-text/80 truncate max-w-xs">
                  {track.albumName}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
