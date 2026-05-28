import { env } from "cloudflare:workers";
import type { APIRoute } from "astro";
import {
  addTrackToPlaylist,
  getPlaylistTracks,
} from "../../../services/spotify";

interface AddTrackRequestBody {
  uri?: string;
}

export const POST: APIRoute = async (context) => {
  try {
    const body = (await context.request.json()) as AddTrackRequestBody;
    const uri = body?.uri;

    if (!uri || typeof uri !== "string") {
      return new Response(JSON.stringify({ error: "Spor-URI mangler." }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // 1. Add track to Spotify
    await addTrackToPlaylist(uri, env);

    // 2. Fetch fresh tracks to return to frontend
    const updatedTracks = await getPlaylistTracks(env);

    return new Response(
      JSON.stringify({
        success: true,
        tracks: updatedTracks,
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    );
  } catch (error) {
    console.error("Error in Spotify Add API:", error);
    return new Response(
      JSON.stringify({ error: "Kunne ikke legge til sangen i spillelisten." }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      },
    );
  }
};
