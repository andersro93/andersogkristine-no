export interface SpotifyTrack {
  id: string;
  name: string;
  artists: string;
  albumName: string;
  albumImageUrl: string;
  uri: string;
  alreadyAdded?: boolean;
}
