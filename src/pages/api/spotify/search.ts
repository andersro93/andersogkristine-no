import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { searchTracks, getPlaylistTracks } from '../../../services/spotify';

export const GET: APIRoute = async (context) => {
  const url = new URL(context.request.url);
  const query = url.searchParams.get('q');

  if (!query || !query.trim()) {
    return new Response(JSON.stringify([]), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
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
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error in Spotify Search API:', error);
    return new Response(
      JSON.stringify({ error: 'Kunne ikke søke etter sanger.' }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
};
