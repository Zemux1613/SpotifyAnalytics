export interface SpotifyImage {
  url: string;
  width: number | null;
  height: number | null;
}

export interface ExternalUrls {
  spotify?: string;
}

/** Kurzfassung eines Künstlers, wie sie in Tracks und Alben steckt. */
export interface ArtistRef {
  id: string;
  name: string;
  uri: string;
  external_urls?: ExternalUrls;
}

export interface SpotifyArtist extends ArtistRef {
  genres?: string[];
  images?: SpotifyImage[];
}

export interface SpotifyAlbum {
  id: string;
  name: string;
  album_type: string;
  total_tracks: number;
  release_date: string;
  release_date_precision: 'year' | 'month' | 'day';
  images: SpotifyImage[];
  artists: ArtistRef[];
  external_urls?: ExternalUrls;
}

export interface SpotifyTrack {
  id: string;
  name: string;
  uri: string;
  duration_ms: number;
  popularity: number;
  explicit: boolean;
  track_number: number;
  disc_number: number;
  is_playable?: boolean;
  artists: ArtistRef[];
  album: SpotifyAlbum;
  external_ids?: { isrc?: string };
  external_urls?: ExternalUrls;
}
