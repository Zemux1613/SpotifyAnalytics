import { SpotifyArtist, SpotifyImage, SpotifyTrack } from '@shared/interfaces/Spotify';

export type TimeRange = 'short_term' | 'medium_term' | 'long_term';

export interface Paging<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
  next: string | null;
  previous: string | null;
}

export interface UserProfile {
  id: string;
  display_name: string | null;
  images?: SpotifyImage[];
}

export interface TrackSearchResponse {
  tracks: Paging<SpotifyTrack>;
}

export interface TrackDetailsResponse {
  track: SpotifyTrack;
  artists: SpotifyArtist[];
}
