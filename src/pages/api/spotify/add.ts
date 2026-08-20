import { env as rawEnv } from "cloudflare:workers";

const env = rawEnv as Env;

import type { APIRoute } from "astro";
import {
  addTrackToPlaylist,
  getPlaylistTracks,
  SpotifyNotConfiguredError,
} from "../../../services/spotify";
import { json, SPOTIFY_UNAVAILABLE } from "../../../utils/http";

interface AddTrackRequestBody {
  uri?: string;
}

export const POST: APIRoute = async (context) => {
  try {
    const body = (await context.request.json()) as AddTrackRequestBody;
    const uri = body?.uri;
    if (!uri || typeof uri !== "string") {
      return json({ error: "Spor-URI mangler." }, 400);
    }

    await addTrackToPlaylist(uri, env);
    const tracks = await getPlaylistTracks(env);
    return json({ success: true, tracks });
  } catch (error) {
    if (error instanceof SpotifyNotConfiguredError) {
      return json(SPOTIFY_UNAVAILABLE, 503);
    }
    console.error("Error in Spotify Add API:", error);
    return json({ error: "Kunne ikke legge til sangen i spillelisten." }, 500);
  }
};
