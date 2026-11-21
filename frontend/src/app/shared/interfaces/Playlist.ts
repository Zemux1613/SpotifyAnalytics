export interface PlaylistSummary {
  id: string;
  name: string;
  owner: string | null;
  track_count: number;
  image_url: string | null;
  spotify_url: string | null;
  collaborative: boolean;
  public: boolean | null;
}

export interface PlaylistSuggestion {
  playlist_id: string;
  name: string;
  image_url: string | null;
  spotify_url: string | null;
  track_count: number;
  match_percent: number;
  method: 'random_forest' | 'genre_fallback';
  already_in_playlist: boolean;
  top_genres: string[];
}

export interface ModelInfo {
  playlists_used: number;
  playlists_trained: number;
  playlists_total: number;
  tracks_used: number;
  genres: number;
  trained_at: string;
  cached: boolean;
}

export interface PlaylistSuggestionsResponse {
  track_id: string;
  suggestions: PlaylistSuggestion[];
  model: ModelInfo;
  message: string | null;
}

export interface AddTrackResponse {
  status: string;
  snapshot_id?: string | null;
}
