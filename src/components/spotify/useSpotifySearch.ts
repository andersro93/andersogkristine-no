import { useEffect, useRef, useState } from "react";
import type { SpotifyTrack } from "./types";

const DEBOUNCE_MS = 400;

/** Debounced search against /api/spotify/search for the given query. */
export function useSpotifySearch(
  query: string,
  onError: (message: string) => void,
) {
  const [results, setResults] = useState<SpotifyTrack[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);

    if (!query.trim()) {
      setResults([]);
      setIsSearching(false);
      return;
    }

    setIsSearching(true);
    timeoutRef.current = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/spotify/search?q=${encodeURIComponent(query)}`,
        );
        if (!res.ok) throw new Error("Søket feilet.");
        setResults((await res.json()) as SpotifyTrack[]);
      } catch (err) {
        console.error(err);
        onError("Det oppstod en feil under søket.");
      } finally {
        setIsSearching(false);
      }
    }, DEBOUNCE_MS);

    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [query, onError]);

  return { results, setResults, isSearching };
}
