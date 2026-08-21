import { useEffect, useState } from "react";
import { PlaylistTable } from "./spotify/PlaylistTable";
import { SearchResults } from "./spotify/SearchResults";
import type { SpotifyTrack } from "./spotify/types";
import { useSpotifySearch } from "./spotify/useSpotifySearch";
import { Icon, Spinner } from "./ui/Icon";
import { Toast, useToast } from "./ui/useToast";

/** Guest-facing Spotify page: open-playlist link, search + add, current playlist. */
export default function SpotifyPlaylist() {
  const [query, setQuery] = useState("");
  const [playlistTracks, setPlaylistTracks] = useState<SpotifyTrack[]>([]);
  const [playlistUrl, setPlaylistUrl] = useState("https://open.spotify.com");
  const [isLoadingPlaylist, setIsLoadingPlaylist] = useState(true);
  const [isUnavailable, setIsUnavailable] = useState(false);
  const [addingUri, setAddingUri] = useState<string | null>(null);

  const { toast, showToast } = useToast();
  const showError = (message: string) => showToast(message, "error");
  const {
    results: searchResults,
    setResults: setSearchResults,
    isSearching,
  } = useSpotifySearch(query, showError);

  // Load the current playlist once
  useEffect(() => {
    async function loadPlaylist() {
      try {
        const res = await fetch("/api/spotify/playlist");
        if (res.status === 503) {
          setIsUnavailable(true);
          return;
        }
        if (!res.ok) throw new Error("Kunne ikke hente spillelisten.");
        const data = (await res.json()) as {
          tracks?: SpotifyTrack[];
          playlistUrl?: string;
        };
        setPlaylistTracks(data.tracks || []);
        setPlaylistUrl(data.playlistUrl || "https://open.spotify.com");
      } catch (err) {
        console.error(err);
        showToast(
          "Klarte ikke å laste spillelisten. Prøv å laste siden på nytt.",
          "error",
        );
      } finally {
        setIsLoadingPlaylist(false);
      }
    }
    loadPlaylist();
  }, [showToast]);

  async function handleAddSong(track: SpotifyTrack) {
    if (addingUri) return; // Prevent double clicks
    setAddingUri(track.uri);

    try {
      const res = await fetch("/api/spotify/add", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uri: track.uri }),
      });
      if (!res.ok) throw new Error("Feilet under lagring.");
      const data = (await res.json()) as {
        success: boolean;
        tracks?: SpotifyTrack[];
        error?: string;
      };
      if (!data.success)
        throw new Error(data.error || "Kunne ikke legge til sang.");

      setPlaylistTracks(data.tracks || []);
      setSearchResults((prev) =>
        prev.map((t) =>
          t.uri === track.uri ? { ...t, alreadyAdded: true } : t,
        ),
      );
      showToast(`"${track.name}" ble lagt til i spillelisten!`, "success");
      setQuery(""); // Reset search input on success
    } catch (err: unknown) {
      console.error(err);
      showToast(
        err instanceof Error
          ? err.message
          : "Klarte ikke å legge til sangen. Vennligst prøv igjen.",
        "error",
      );
    } finally {
      setAddingUri(null);
    }
  }

  if (isUnavailable) {
    return (
      <div className="text-center py-12 space-y-3 font-sans text-brand-title">
        <span className="text-3xl">🎶</span>
        <p className="text-body-serif">
          Musikkønsker er ikke tilgjengelig akkurat nå.
        </p>
        <p className="text-caption">Prøv igjen litt senere.</p>
      </div>
    );
  }

  return (
    <div className="space-y-12 font-sans text-brand-title select-none">
      <Toast toast={toast} />

      {/* ── Open in Spotify ── */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-6 bg-brand-bg/40 border border-brand-title/10 rounded-2xl p-6 md:p-8">
        <div className="text-center sm:text-left space-y-2">
          <h2 className="font-serif text-2xl font-medium">
            Bli med på å lage spillelisten!
          </h2>
          <p className="text-body max-w-md">
            Her kan du foreslå låter du vil høre på dansegulvet. Klikk under for
            å åpne og følge listen direkte på din Spotify.
          </p>
        </div>

        <a
          href={playlistUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-3 bg-[#1DB954] hover:bg-[#1ed760] text-white px-6 py-3.5 rounded-full text-sm font-semibold tracking-wider transition-all duration-300 hover:shadow-lg focus:outline-none focus:ring-2 focus:ring-[#1DB954]"
        >
          <Icon
            name="spotify"
            className="w-5 h-5 fill-current"
            title="Spotify"
          />
          <span>ÅPNE I SPOTIFY</span>
        </a>
      </div>

      {/* ── Search ── */}
      <div className="space-y-6">
        <div className="max-w-xl mx-auto space-y-2">
          <label
            htmlFor="music-search"
            className="block text-center font-serif text-xl text-brand-title font-medium"
          >
            Søk etter din favorittlåt
          </label>
          <div className="relative">
            <input
              type="text"
              id="music-search"
              placeholder="F.eks. Dancing Queen..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-full px-5 py-4 rounded-xl border border-brand-title/15 bg-white text-brand-title focus:outline-none focus:ring-2 focus:ring-brand-title/50 text-center text-lg shadow-sm"
            />
            {isSearching && (
              <div className="absolute right-4 top-1/2 -translate-y-1/2">
                <Spinner
                  className="h-5 w-5 text-brand-title/50"
                  title="Søker"
                />
              </div>
            )}
          </div>
        </div>

        <SearchResults
          results={searchResults}
          addingUri={addingUri}
          onAdd={handleAddSong}
        />
      </div>

      <div className="w-12 h-px bg-brand-title/25 mx-auto my-12" />

      {/* ── Current playlist ── */}
      <div className="space-y-6">
        <div className="text-center">
          <h2 className="font-serif text-3xl">Ønskede låter</h2>
          <p className="text-lead mt-1">
            {isLoadingPlaylist
              ? "Laster spilleliste..."
              : `${playlistTracks.length} sanger foreslått`}
          </p>
        </div>
        <PlaylistTable tracks={playlistTracks} isLoading={isLoadingPlaylist} />
      </div>
    </div>
  );
}
