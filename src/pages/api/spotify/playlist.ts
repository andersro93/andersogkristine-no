import type { APIRoute } from "astro";
import { env } from "../../../runtime";
import {
  getPlaylistTracks,
  getSpotifyPlaylistUrl,
  SpotifyNotConfiguredError,
} from "../../../services/spotify";
import { json, SPOTIFY_UNAVAILABLE } from "../../../utils/http";

export const GET: APIRoute = async () => {
  try {
    const tracks = await getPlaylistTracks(env);
    return json({ tracks, playlistUrl: getSpotifyPlaylistUrl(env) });
  } catch (error) {
    if (error instanceof SpotifyNotConfiguredError) {
      return json(SPOTIFY_UNAVAILABLE, 503);
    }
    console.error("Error in Spotify Playlist API:", error);
    return json({ error: "Kunne ikke hente spilleliste." }, 500);
  }
};
