export interface SpotifyTrack {
  id: string;
  name: string;
  artists: string;
  albumName: string;
  albumImageUrl: string;
  uri: string;
  alreadyAdded?: boolean;
}

// In-memory databases for mock mode
let mockPlaylistTracks: SpotifyTrack[] = [
  {
    id: 'mock-1',
    name: 'Dancing Queen',
    artists: 'ABBA',
    albumName: 'Arrival',
    albumImageUrl: 'https://images.unsplash.com/photo-1470225620780-dba8ba36b745?auto=format&fit=crop&w=150&h=150&q=80',
    uri: 'spotify:track:0vG1r2d4qf2E7f3p3L3X3X',
  },
  {
    id: 'mock-2',
    name: 'Valerie',
    artists: 'Mark Ronson, Amy Winehouse',
    albumName: 'Version',
    albumImageUrl: 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?auto=format&fit=crop&w=150&h=150&q=80',
    uri: 'spotify:track:1vG2r3d4qf2E7f3p3L4X4X',
  },
];

const mockCatalog: SpotifyTrack[] = [
  {
    id: 'mock-1',
    name: 'Dancing Queen',
    artists: 'ABBA',
    albumName: 'Arrival',
    albumImageUrl: 'https://images.unsplash.com/photo-1470225620780-dba8ba36b745?auto=format&fit=crop&w=150&h=150&q=80',
    uri: 'spotify:track:0vG1r2d4qf2E7f3p3L3X3X',
  },
  {
    id: 'mock-2',
    name: 'Valerie',
    artists: 'Mark Ronson, Amy Winehouse',
    albumName: 'Version',
    albumImageUrl: 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?auto=format&fit=crop&w=150&h=150&q=80',
    uri: 'spotify:track:1vG2r3d4qf2E7f3p3L4X4X',
  },
  {
    id: 'mock-3',
    name: 'I Wanna Dance with Somebody',
    artists: 'Whitney Houston',
    albumName: 'Whitney',
    albumImageUrl: 'https://images.unsplash.com/photo-1498038432885-c6f3f1b912ee?auto=format&fit=crop&w=150&h=150&q=80',
    uri: 'spotify:track:2vG3r4d5qf3E8f4p4L5X5X',
  },
  {
    id: 'mock-4',
    name: 'September',
    artists: 'Earth, Wind & Fire',
    albumName: 'The Best of Earth, Wind & Fire, Vol. 1',
    albumImageUrl: 'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?auto=format&fit=crop&w=150&h=150&q=80',
    uri: 'spotify:track:3vG4r5d6qf4E9f5p5L6X6X',
  },
  {
    id: 'mock-5',
    name: 'Marry You',
    artists: 'Bruno Mars',
    albumName: 'Doo-Wops & Hooligans',
    albumImageUrl: 'https://images.unsplash.com/photo-1465847899084-d164df4dedc6?auto=format&fit=crop&w=150&h=150&q=80',
    uri: 'spotify:track:4vG5r6d7qf5E0f6p6L7X7X',
  },
  {
    id: 'mock-6',
    name: 'Billie Jean',
    artists: 'Michael Jackson',
    albumName: 'Thriller',
    albumImageUrl: 'https://images.unsplash.com/photo-1487180142328-0c4e37023af5?auto=format&fit=crop&w=150&h=150&q=80',
    uri: 'spotify:track:5vG6r7d8qf6E1f7p7L8X8X',
  },
  {
    id: 'mock-7',
    name: 'Hey Jude',
    artists: 'The Beatles',
    albumName: 'The Beatles 1',
    albumImageUrl: 'https://images.unsplash.com/photo-1506157786151-b8491531f063?auto=format&fit=crop&w=150&h=150&q=80',
    uri: 'spotify:track:6vG7r8d9qf7E2f8p8L9X9X',
  },
];

// In-memory cache for client token
let cachedToken: string | null = null;
let tokenExpiresAt = 0;

/**
 * Check if the Spotify environment credentials are set.
 */
export function isSpotifyConfigured(env: any): boolean {
  const clientId = env?.SPOTIFY_CLIENT_ID || process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = env?.SPOTIFY_CLIENT_SECRET || process.env.SPOTIFY_CLIENT_SECRET;
  const refreshToken = env?.SPOTIFY_REFRESH_TOKEN || process.env.SPOTIFY_REFRESH_TOKEN;
  const playlistId = env?.SPOTIFY_PLAYLIST_ID || process.env.SPOTIFY_PLAYLIST_ID;

  return !!(clientId && clientSecret && refreshToken && playlistId);
}

/**
 * Retrieves a Spotify API Access Token using the stored Refresh Token.
 */
async function getAccessToken(env: any): Promise<string> {
  if (cachedToken && Date.now() < tokenExpiresAt) {
    return cachedToken;
  }

  const clientId = env?.SPOTIFY_CLIENT_ID || process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = env?.SPOTIFY_CLIENT_SECRET || process.env.SPOTIFY_CLIENT_SECRET;
  const refreshToken = env?.SPOTIFY_REFRESH_TOKEN || process.env.SPOTIFY_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error('Spotify configuration is incomplete.');
  }

  console.log('Fetching new Spotify access token...');
  const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basicAuth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Failed to refresh Spotify access token: ${errorText}`);
  }

  const data = await res.json();
  cachedToken = data.access_token;
  tokenExpiresAt = Date.now() + data.expires_in * 1000 - 60000; // 1-minute buffer

  return cachedToken!;
}

/**
 * Search Spotify catalog for songs.
 */
export async function searchTracks(query: string, env: any): Promise<SpotifyTrack[]> {
  if (!query.trim()) return [];

  // Mock Mode fallback
  if (!isSpotifyConfigured(env)) {
    console.log('Spotify credentials missing, running search in Mock Mode.');
    const lowerQuery = query.toLowerCase();
    return mockCatalog.filter(
      (track) =>
        track.name.toLowerCase().includes(lowerQuery) ||
        track.artists.toLowerCase().includes(lowerQuery) ||
        track.albumName.toLowerCase().includes(lowerQuery)
    );
  }

  try {
    const token = await getAccessToken(env);
    const searchUrl = `https://api.spotify.com/v1/search?q=${encodeURIComponent(query)}&type=track&limit=10`;

    const res = await fetch(searchUrl, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!res.ok) {
      throw new Error(`Spotify search API error: ${res.statusText}`);
    }

    const data = await res.json();
    return (data.tracks?.items || []).map((item: any) => ({
      id: item.id,
      name: item.name,
      artists: item.artists.map((a: any) => a.name).join(', '),
      albumName: item.album.name,
      albumImageUrl: item.album.images?.[2]?.url || item.album.images?.[1]?.url || item.album.images?.[0]?.url || '',
      uri: item.uri,
    }));
  } catch (err) {
    console.error('Error searching Spotify tracks:', err);
    throw err;
  }
}

/**
 * Get all tracks currently in the playlist (cached in Cloudflare KV).
 */
export async function getPlaylistTracks(env: any): Promise<SpotifyTrack[]> {
  const kv = env?.WEDDING_CACHE;

  // Mock Mode fallback
  if (!isSpotifyConfigured(env)) {
    return mockPlaylistTracks;
  }

  const cacheKey = 'spotify_playlist_tracks';

  // 1. Try Cache
  if (kv) {
    try {
      const cached = await kv.get(cacheKey);
      if (cached) {
        return JSON.parse(cached);
      }
    } catch (err) {
      console.error('KV read error for Spotify tracks:', err);
    }
  }

  // 2. Fetch from Spotify API
  try {
    const token = await getAccessToken(env);
    const playlistId = env?.SPOTIFY_PLAYLIST_ID || process.env.SPOTIFY_PLAYLIST_ID;
    
    // We retrieve up to 100 tracks. Can support paging if needed, but 100 is usually plenty.
    const url = `https://api.spotify.com/v1/playlists/${playlistId}/tracks?limit=100`;

    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!res.ok) {
      throw new Error(`Spotify Playlist API error: ${res.statusText}`);
    }

    const data = await res.json();
    const tracks: SpotifyTrack[] = (data.items || [])
      .filter((item: any) => item.track) // Filter out null/deleted tracks
      .map((item: any) => {
        const t = item.track;
        return {
          id: t.id,
          name: t.name,
          artists: t.artists.map((a: any) => a.name).join(', '),
          albumName: t.album.name,
          albumImageUrl: t.album.images?.[2]?.url || t.album.images?.[1]?.url || t.album.images?.[0]?.url || '',
          uri: t.uri,
        };
      });

    // 3. Save to Cache (5-minute TTL)
    if (kv) {
      try {
        await kv.put(cacheKey, JSON.stringify(tracks), { expirationTtl: 300 });
      } catch (err) {
        console.error('KV write error for Spotify tracks:', err);
      }
    }

    return tracks;
  } catch (err) {
    console.error('Error fetching Spotify playlist tracks:', err);
    throw err;
  }
}

/**
 * Add a track to the wedding Spotify playlist.
 */
export async function addTrackToPlaylist(trackUri: string, env: any): Promise<void> {
  // Mock Mode fallback
  if (!isSpotifyConfigured(env)) {
    const matchingTrack = mockCatalog.find((t) => t.uri === trackUri);
    if (matchingTrack) {
      // Check if already in mock list
      if (!mockPlaylistTracks.some((t) => t.uri === trackUri)) {
        mockPlaylistTracks = [matchingTrack, ...mockPlaylistTracks];
      }
    } else {
      // Create a generic fallback track
      const parts = trackUri.split(':');
      const id = parts[parts.length - 1] || 'mock-added';
      const mockTrack: SpotifyTrack = {
        id,
        name: 'Foreslått sang',
        artists: 'Ukjent artist',
        albumName: 'Foreslått album',
        albumImageUrl: 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?auto=format&fit=crop&w=150&h=150&q=80',
        uri: trackUri,
      };
      mockPlaylistTracks = [mockTrack, ...mockPlaylistTracks];
    }
    return;
  }

  try {
    const token = await getAccessToken(env);
    const playlistId = env?.SPOTIFY_PLAYLIST_ID || process.env.SPOTIFY_PLAYLIST_ID;
    const url = `https://api.spotify.com/v1/playlists/${playlistId}/tracks`;

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        uris: [trackUri],
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Failed to add track to Spotify playlist: ${errText}`);
    }

    // Invalidate Cache
    const kv = env?.WEDDING_CACHE;
    if (kv) {
      try {
        await kv.delete('spotify_playlist_tracks');
        console.log('Spotify playlist cache busted.');
      } catch (err) {
        console.error('Failed to bust Spotify cache:', err);
      }
    }
  } catch (err) {
    console.error('Error adding track to Spotify playlist:', err);
    throw err;
  }
}

/**
 * Get Spotify Playlist URL for public link.
 */
export function getSpotifyPlaylistUrl(env: any): string {
  const playlistId = env?.SPOTIFY_PLAYLIST_ID || process.env.SPOTIFY_PLAYLIST_ID || '37i9dQZF1DXcBWIGmq7BmE';
  return `https://open.spotify.com/playlist/${playlistId}`;
}

/**
 * Reset memory state (useful for tests)
 */
export function resetMockPlaylist(): void {
  mockPlaylistTracks = [
    {
      id: 'mock-1',
      name: 'Dancing Queen',
      artists: 'ABBA',
      albumName: 'Arrival',
      albumImageUrl: 'https://images.unsplash.com/photo-1470225620780-dba8ba36b745?auto=format&fit=crop&w=150&h=150&q=80',
      uri: 'spotify:track:0vG1r2d4qf2E7f3p3L3X3X',
    },
    {
      id: 'mock-2',
      name: 'Valerie',
      artists: 'Mark Ronson, Amy Winehouse',
      albumName: 'Version',
      albumImageUrl: 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?auto=format&fit=crop&w=150&h=150&q=80',
      uri: 'spotify:track:1vG2r3d4qf2E7f3p3L4X4X',
    },
  ];
}
