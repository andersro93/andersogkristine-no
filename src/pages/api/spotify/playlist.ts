import { env as rawEnv } from "cloudflare:workers";

const env = rawEnv as Env;

import type { APIRoute } from "astro";
import {
  getPlaylistTracks,
  getSpotifyPlaylistUrl,
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
