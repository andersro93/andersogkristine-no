import { describe, test, expect, beforeEach } from 'bun:test';
import {
  isSpotifyConfigured,
  searchTracks,
  getPlaylistTracks,
  addTrackToPlaylist,
  getSpotifyPlaylistUrl,
  resetMockPlaylist,
} from './spotify';

describe('Spotify Playlist Integration (Mock Mode)', () => {
  beforeEach(() => {
    resetMockPlaylist();
  });

  describe('isSpotifyConfigured', () => {
    test('should return false for empty/undefined environment', () => {
      const mockEnv = {};
      expect(isSpotifyConfigured(mockEnv)).toBe(false);
    });

    test('should return true if all keys are defined', () => {
      const mockEnv = {
        SPOTIFY_CLIENT_ID: 'id',
        SPOTIFY_CLIENT_SECRET: 'secret',
        SPOTIFY_REFRESH_TOKEN: 'refresh',
        SPOTIFY_PLAYLIST_ID: 'playlist',
      };
      expect(isSpotifyConfigured(mockEnv)).toBe(true);
    });
  });

  describe('getSpotifyPlaylistUrl', () => {
    test('should return standard playlist URL', () => {
      const mockEnv = { SPOTIFY_PLAYLIST_ID: 'test_playlist_123' };
      expect(getSpotifyPlaylistUrl(mockEnv)).toBe('https://open.spotify.com/playlist/test_playlist_123');
    });

    test('should fall back if not configured', () => {
      expect(getSpotifyPlaylistUrl({})).toContain('https://open.spotify.com/playlist/');
    });
  });

  describe('Mock Catalog Queries', () => {
    test('should search mock catalog tracks', async () => {
      const results = await searchTracks('abba', {});
      expect(results).toHaveLength(1);
      expect(results[0].name).toBe('Dancing Queen');
      expect(results[0].artists).toBe('ABBA');
    });

    test('should return empty array for mismatch query', async () => {
      const results = await searchTracks('nonexistentartistsongtext', {});
      expect(results).toHaveLength(0);
    });

    test('should handle case insensitivity', async () => {
      const results = await searchTracks('SEPTEMBER', {});
      expect(results).toHaveLength(1);
      expect(results[0].name).toBe('September');
    });
  });

  describe('Mock Playlist Operations', () => {
    test('should retrieve initial mock playlist tracks', async () => {
      const tracks = await getPlaylistTracks({});
      expect(tracks).toHaveLength(2);
      expect(tracks[0].name).toBe('Dancing Queen');
      expect(tracks[1].name).toBe('Valerie');
    });

    test('should add new tracks from catalog to mock playlist', async () => {
      const trackUriToAdd = 'spotify:track:3vG4r5d6qf4E9f5p5L6X6X'; // September
      
      // Add track
      await addTrackToPlaylist(trackUriToAdd, {});
      
      const tracksAfter = await getPlaylistTracks({});
      expect(tracksAfter).toHaveLength(3);
      expect(tracksAfter[0].name).toBe('September');
      expect(tracksAfter[1].name).toBe('Dancing Queen');
    });

    test('should prevent duplicate additions in mock playlist', async () => {
      const trackUriToAdd = 'spotify:track:0vG1r2d4qf2E7f3p3L3X3X'; // ABBA (already in list)

      await addTrackToPlaylist(trackUriToAdd, {});

      const tracksAfter = await getPlaylistTracks({});
      expect(tracksAfter).toHaveLength(2); // Still 2, no duplicates
    });

    test('should support adding arbitrary fallback track if not in catalog', async () => {
      const customUri = 'spotify:track:newcustomid';
      await addTrackToPlaylist(customUri, {});

      const tracks = await getPlaylistTracks({});
      expect(tracks).toHaveLength(3);
      expect(tracks[0].name).toBe('Foreslått sang');
      expect(tracks[0].uri).toBe(customUri);
    });
  });
});
