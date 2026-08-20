import { useCallback, useEffect, useRef, useState } from "react";
import { Icon, Spinner } from "./ui/Icon";

interface SpotifyTrack {
  id: string;
  name: string;
  artists: string;
  albumName: string;
  albumImageUrl: string;
  uri: string;
  alreadyAdded?: boolean;
}

export default function SpotifyPlaylist() {
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SpotifyTrack[]>([]);
  const [playlistTracks, setPlaylistTracks] = useState<SpotifyTrack[]>([]);
  const [playlistUrl, setPlaylistUrl] = useState("https://open.spotify.com");
  const [isSearching, setIsSearching] = useState(false);
  const [isLoadingPlaylist, setIsLoadingPlaylist] = useState(true);
  const [isUnavailable, setIsUnavailable] = useState(false);
  const [addingUri, setAddingUri] = useState<string | null>(null);
  const [toast, setToast] = useState<{
    message: string;
    type: "success" | "error";
  } | null>(null);

  const debounceTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Helper to show custom notification toast
  const showToast = useCallback(
    (message: string, type: "success" | "error" = "success") => {
      setToast({ message, type });
      setTimeout(() => setToast(null), 4000);
    },
    [],
  );

  // 1. Load initial playlist tracks
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

  // 2. Debounce Search Queries
  useEffect(() => {
    if (debounceTimeoutRef.current) {
      clearTimeout(debounceTimeoutRef.current);
    }

    if (!query.trim()) {
      setSearchResults([]);
      setIsSearching(false);
      return;
    }

    setIsSearching(true);
    debounceTimeoutRef.current = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/spotify/search?q=${encodeURIComponent(query)}`,
        );
        if (!res.ok) throw new Error("Søket feilet.");
        const data = (await res.json()) as SpotifyTrack[];
        setSearchResults(data);
      } catch (err) {
        console.error(err);
        showToast("Det oppstod en feil under søket.", "error");
      } finally {
        setIsSearching(false);
      }
    }, 400); // 400ms debounce delay

    return () => {
      if (debounceTimeoutRef.current) clearTimeout(debounceTimeoutRef.current);
    };
  }, [query, showToast]);

  // 3. Add Song handler
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

      if (data.success) {
        // Update playlist tracks state
        setPlaylistTracks(data.tracks || []);
        // Update search list state (disable the added song)
        setSearchResults((prev) =>
          prev.map((t) =>
            t.uri === track.uri ? { ...t, alreadyAdded: true } : t,
          ),
        );
        showToast(`"${track.name}" ble lagt til i spillelisten!`, "success");
        setQuery(""); // Reset search input on success
      } else {
        throw new Error(data.error || "Kunne ikke legge til sang.");
      }
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
      {/* Toast Notification */}
      {toast && (
        <div
          className={`fixed bottom-5 right-5 z-50 px-6 py-4 rounded-xl shadow-lg border text-sm font-medium transition-all duration-300 transform translate-y-0 animate-fade-in flex items-center gap-3 ${
            toast.type === "success"
              ? "bg-emerald-50 border-emerald-200 text-emerald-800"
              : "bg-red-50 border-red-200 text-red-800"
          }`}
        >
          {toast.type === "success" ? (
            <Icon
              name="check"
              className="w-5 h-5 text-emerald-600"
              title="Suksess"
            />
          ) : (
            <Icon
              name="alertCircle"
              className="w-5 h-5 text-red-600"
              title="Feil"
            />
          )}
          <span>{toast.message}</span>
        </div>
      )}

      {/* ── TOP SECTION: SPONSOR / Spotify Redirect Link ── */}
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
          {/* Spotify Icon */}
          <Icon
            name="spotify"
            className="w-5 h-5 fill-current"
            title="Spotify"
          />
          <span>ÅPNE I SPOTIFY</span>
        </a>
      </div>

      {/* ── SEARCH ENGINE ── */}
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

        {/* Search Results list */}
        {searchResults.length > 0 && (
          <div className="bg-[#fcfbf9]/60 border border-brand-title/10 rounded-xl overflow-hidden divide-y divide-brand-title/5 max-w-2xl mx-auto shadow-md animate-fade-in">
            {searchResults.map((track) => (
              <div
                key={track.id}
                className="flex items-center justify-between p-4 gap-4 hover:bg-brand-title/2 transition duration-200"
              >
                <div className="flex items-center gap-4 min-w-0">
                  <a
                    href={`https://open.spotify.com/track/${track.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="shrink-0 group relative cursor-pointer"
                    title="Åpne i Spotify"
                  >
                    {track.albumImageUrl ? (
                      <img
                        src={track.albumImageUrl}
                        alt={track.albumName}
                        className="w-12 h-12 rounded object-cover shadow-xs transition duration-300 group-hover:scale-105 group-hover:opacity-85"
                        loading="lazy"
                      />
                    ) : (
                      <div className="w-12 h-12 bg-brand-title/5 rounded flex items-center justify-center text-brand-title/30 transition duration-300 group-hover:scale-105">
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
                  <div className="min-w-0">
                    <a
                      href={`https://open.spotify.com/track/${track.id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-serif font-semibold text-base text-brand-title hover:underline truncate block"
                      title="Åpne i Spotify"
                    >
                      {track.name}
                    </a>
                    <p className="text-xs text-brand-text/75 truncate">
                      {track.artists}
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => handleAddSong(track)}
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
        )}
      </div>

      <div className="w-12 h-px bg-brand-title/25 mx-auto my-12" />

      {/* ── CURRENT PLAYLIST ── */}
      <div className="space-y-6">
        <div className="text-center">
          <h2 className="font-serif text-3xl">Ønskede låter</h2>
          <p className="text-lead mt-1">
            {isLoadingPlaylist
              ? "Laster spilleliste..."
              : `${playlistTracks.length} sanger foreslått`}
          </p>
        </div>

        {isLoadingPlaylist ? (
          /* Skeletons Loader */
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
        ) : playlistTracks.length === 0 ? (
          <div className="text-center py-12 bg-brand-bg/10 rounded-2xl border border-dashed border-brand-title/20 max-w-4xl mx-auto">
            <span className="text-3xl">💿</span>
            <p className="text-body-serif text-brand-title/80 mt-3">
              Ingen sanger er foreslått enda.
            </p>
            <p className="text-caption mt-1">
              Vær den første til å foreslå en sang ved å søke over!
            </p>
          </div>
        ) : (
          /* Custom Table/List showing the tracks */
          <div className="bg-[#fcfbf9]/60 border border-brand-title/10 rounded-2xl overflow-hidden shadow-md max-w-4xl mx-auto animate-fade-in">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-brand-title/15 text-xs uppercase tracking-widest text-brand-title/70 bg-brand-title/2">
                    <th className="py-4 px-6 w-16">#</th>
                    <th className="py-4 px-4">Tittel</th>
                    <th className="py-4 px-6 hidden md:table-cell">Album</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-brand-title/5">
                  {playlistTracks.map((track, idx) => (
                    <tr
                      key={track.id}
                      className="hover:bg-brand-title/1 transition duration-150 text-sm"
                    >
                      {/* Cover Number */}
                      <td className="py-3.5 px-6 text-brand-text/50 font-medium">
                        {idx + 1}
                      </td>

                      {/* Cover & Title */}
                      <td className="py-3.5 px-4 font-sans">
                        <div className="flex items-center gap-4">
                          <a
                            href={`https://open.spotify.com/track/${track.id}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="shrink-0 group relative cursor-pointer"
                            title="Åpne i Spotify"
                          >
                            {track.albumImageUrl ? (
                              <img
                                src={track.albumImageUrl}
                                alt={track.albumName}
                                className="w-10 h-10 rounded object-cover shadow-xs transition duration-300 group-hover:scale-105 group-hover:opacity-85"
                                loading="lazy"
                              />
                            ) : (
                              <div className="w-10 h-10 bg-brand-title/5 rounded flex items-center justify-center shrink-0 text-brand-title/30 transition duration-300 group-hover:scale-105">
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
                          <div className="min-w-0">
                            <a
                              href={`https://open.spotify.com/track/${track.id}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="font-serif font-semibold text-brand-title hover:underline truncate block"
                              title="Åpne i Spotify"
                            >
                              {track.name}
                            </a>
                            <p className="text-xs text-brand-text/75 truncate">
                              {track.artists}
                            </p>
                          </div>
                        </div>
                      </td>

                      {/* Album */}
                      <td className="py-3.5 px-6 hidden md:table-cell text-brand-text/80 truncate max-w-xs">
                        {track.albumName}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
