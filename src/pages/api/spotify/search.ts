import { env as rawEnv } from "cloudflare:workers";

const env = rawEnv as Env;

import type { APIRoute } from "astro";
import {
  getPlaylistTracks,
  SpotifyNotConfiguredError,
  searchTracks,
} from "../../../services/spotify";

export const GET: APIRoute = async (context) => {
  const url = new URL(context.request.url);
  const query = url.searchParams.get("q");

  if (!query?.trim()) {
    return new Response(JSON.stringify([]), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    // Fetch search results and current playlist in parallel to compute duplicate status
    const [searchResults, playlistTracks] = await Promise.all([
      searchTracks(query, env),
      getPlaylistTracks(env),
    ]);

    const playlistUris = new Set(playlistTracks.map((track) => track.uri));

    const mappedResults = searchResults.map((track) => ({
      ...track,
      alreadyAdded: playlistUris.has(track.uri),
    }));

    return new Response(JSON.stringify(mappedResults), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    if (error instanceof SpotifyNotConfiguredError) {
      return new Response(
        JSON.stringify({
          error: "Musikkønsker er ikke tilgjengelig akkurat nå.",
          unavailable: true,
        }),
        { status: 503, headers: { "Content-Type": "application/json" } },
      );
    }
    console.error("Error in Spotify Search API:", error);
    return new Response(
      JSON.stringify({ error: "Kunne ikke søke etter sanger." }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      },
    );
  }
};
