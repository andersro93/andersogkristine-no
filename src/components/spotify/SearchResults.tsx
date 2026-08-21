import { Icon } from "../ui/Icon";
import { TrackCover, TrackTitle } from "./TrackCells";
import type { SpotifyTrack } from "./types";

interface Props {
  results: SpotifyTrack[];
  addingUri: string | null;
  onAdd: (track: SpotifyTrack) => void;
}

export function SearchResults({ results, addingUri, onAdd }: Props) {
  if (results.length === 0) return null;
  return (
    <div className="bg-[#fcfbf9]/60 border border-brand-title/10 rounded-xl overflow-hidden divide-y divide-brand-title/5 max-w-2xl mx-auto shadow-md animate-fade-in">
      {results.map((track) => (
        <div
          key={track.id}
          className="flex items-center justify-between p-4 gap-4 hover:bg-brand-title/2 transition duration-200"
        >
          <div className="flex items-center gap-4 min-w-0">
            <TrackCover track={track} size="w-12 h-12" />
            <TrackTitle track={track} titleClass="text-base " />
          </div>

          <button
            type="button"
            onClick={() => onAdd(track)}
            disabled={track.alreadyAdded || addingUri !== null}
            className={`px-4 py-2 rounded-lg text-xs font-semibold tracking-wider uppercase transition-all duration-200 ${
              track.alreadyAdded
                ? "bg-brand-title/5 text-brand-title/40 border border-brand-title/10 cursor-not-allowed"
                : addingUri === track.uri
                  ? "bg-brand-title/10 text-brand-title/60 cursor-not-allowed"
                  : "bg-brand-title text-brand-bg hover:bg-brand-title/90 hover:shadow-xs"
            }`}
          >
            {track.alreadyAdded ? (
              <span className="flex items-center gap-1">
                <Icon
                  name="check"
                  className="w-3.5 h-3.5"
                  strokeWidth={3}
                  title="Lagt til"
                />
                Lagt til
              </span>
            ) : addingUri === track.uri ? (
              "Legger til..."
            ) : (
              "Legg til"
            )}
          </button>
        </div>
      ))}
    </div>
  );
}
