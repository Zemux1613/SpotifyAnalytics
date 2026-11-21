import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { AudioAnalysisSummary, ModelStatus } from './dashboard-kpi.model';

/**
 * Endpunkte für die KPI-Karten (BPM-Zusammenfassung, Modell-Status).
 * Handgeschrieben wie ListeningInsightsApi, bis `make openapi` sie generiert.
 */
@Injectable({ providedIn: 'root' })
export class DashboardKpiApi {
  private readonly http = inject(HttpClient);

  audioSummary(trackIds: string[]): Observable<AudioAnalysisSummary> {
    const params = new HttpParams({ fromObject: { track_ids: trackIds } });
    return this.http.get<AudioAnalysisSummary>('/api/tracks/audio-analysis/summary', { params });
  }

  startAudioAnalysis(trackId: string): Observable<unknown> {
    return this.http.post(`/api/tracks/${encodeURIComponent(trackId)}/audio-analysis`, null);
  }

  modelStatus(): Observable<ModelStatus> {
    return this.http.get<ModelStatus>('/api/playlists/model');
  }

  trainModel(): Observable<ModelStatus> {
    return this.http.post<ModelStatus>('/api/playlists/model', null);
  }
}
