import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { TimeRangeDto } from '../api/generated';
import { ListeningInsights } from './listening-insights.model';

@Injectable({ providedIn: 'root' })
export class ListeningInsightsApi {
  private readonly http = inject(HttpClient);

  get(timeRange: TimeRangeDto): Observable<ListeningInsights> {
    const params = new HttpParams()
      .set('time_range', timeRange)
      .set('timezone', Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');

    return this.http.get<ListeningInsights>('/api/me/listening-insights', { params });
  }
}
