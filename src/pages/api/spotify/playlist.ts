import { env as rawEnv } from "cloudflare:workers";

const env = rawEnv as Env;

import type { APIRoute } from "astro";
import {
  getPlaylistTracks,
  getSpotifyPlaylistUrl,
  SpotifyNotConfiguredError,
} from "../../../services/spotify";

export const GET: APIRoute = async () => {
  try {
    const tracks = await getPlaylistTracks(env);
    const playlistUrl = getSpotifyPlaylistUrl(env);

    return new Response(
      JSON.stringify({
        tracks,
        playlistUrl,
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    );
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
    console.error("Error in Spotify Playlist API:", error);
    return new Response(
      JSON.stringify({ error: "Kunne ikke hente spilleliste." }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      },
    );
  }
};
