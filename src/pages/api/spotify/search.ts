import { env as rawEnv } from "cloudflare:workers";

const env = rawEnv as Env;

import type { APIRoute } from "astro";
import {
  getPlaylistTracks,
  SpotifyNotConfiguredError,
  searchTracks,
} from "../../../services/spotify";
import { json, SPOTIFY_UNAVAILABLE } from "../../../utils/http";

export const GET: APIRoute = async (context) => {
  const query = new URL(context.request.url).searchParams.get("q");
  if (!query?.trim()) {
    return json([]);
  }

  try {
    // Search and the current playlist in parallel so duplicates can be flagged
    const [searchResults, playlistTracks] = await Promise.all([
      searchTracks(query, env),
      getPlaylistTracks(env),
    ]);
    const playlistUris = new Set(playlistTracks.map((track) => track.uri));
    return json(
      searchResults.map((track) => ({
        ...track,
        alreadyAdded: playlistUris.has(track.uri),
      })),
    );
  } catch (error) {
    if (error instanceof SpotifyNotConfiguredError) {
      return json(SPOTIFY_UNAVAILABLE, 503);
    }
    console.error("Error in Spotify Search API:", error);
    return json({ error: "Kunne ikke søke etter sanger." }, 500);
  }
};
