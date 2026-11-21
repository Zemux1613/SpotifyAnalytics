import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { Paging, TimeRange, TrackDetailsResponse, TrackSearchResponse } from '../../core/models';
import { SpotifyArtist, SpotifyTrack } from '@shared/interfaces/Spotify';
import { AddTrackResponse, PlaylistSuggestionsResponse } from '@shared/interfaces/Playlist';

const API = '/api';

@Injectable({ providedIn: 'root' })
export class SpotifyApiService {
  private readonly http = inject(HttpClient);

  topArtists(timeRange: TimeRange, limit = 20): Observable<Paging<SpotifyArtist>> {
    return this.http.get<Paging<SpotifyArtist>>(`${API}/me/top/artists`, {
      params: { time_range: timeRange, limit },
    });
  }

  topTracks(timeRange: TimeRange, limit = 20): Observable<Paging<SpotifyTrack>> {
    return this.http.get<Paging<SpotifyTrack>>(`${API}/me/top/tracks`, {
      params: { time_range: timeRange, limit },
    });
  }

  searchTracks(query: string): Observable<TrackSearchResponse> {
    return this.http.get<TrackSearchResponse>(`${API}/tracks/search`, { params: { q: query } });
  }

  trackDetails(trackId: string): Observable<TrackDetailsResponse> {
    return this.http.get<TrackDetailsResponse>(`${API}/tracks/${encodeURIComponent(trackId)}`);
  }

  playlistSuggestions(trackId: string, refresh = false): Observable<PlaylistSuggestionsResponse> {
    return this.http.get<PlaylistSuggestionsResponse>(
      `${API}/tracks/${encodeURIComponent(trackId)}/playlist-suggestions`,
      { params: { refresh } },
    );
  }

  addTrackToPlaylist(playlistId: string, trackUri: string): Observable<AddTrackResponse> {
    return this.http.post<AddTrackResponse>(
      `${API}/playlists/${encodeURIComponent(playlistId)}/tracks`,
      { track_uri: trackUri },
    );
  }
}
