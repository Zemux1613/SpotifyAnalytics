import { Component, computed, DestroyRef, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { forkJoin, of, Subscription } from 'rxjs';
import { errorMessage } from '../core/http-error';
import {
  ArtistPagingDto,
  MeApi,
  SpotifyArtistDto,
  SpotifyTrackDto,
  TimeRangeDto,
  TopItemTypeDto,
  TrackPagingDto,
} from '../api/generated';
import { DashboardStats, Metric } from './dashboard.model.component';
import { ListeningInsightsApi } from './listening-insights.api';
import { ListeningHeatmapCell, ListeningInsights } from './listening-insights.model';

const RANGES: { value: TimeRangeDto; label: string }[] = [
  { value: 'short_term' as TimeRangeDto, label: 'Letzte 4 Wochen' },
  { value: 'medium_term' as TimeRangeDto, label: 'Letzte 6 Monate' },
  { value: 'long_term' as TimeRangeDto, label: 'Letztes Jahr' },
];

/**
 * Spotify liefert keine echten Stream-Zahlen oder Hörhistorien.
 * Deshalb vergleichen wir den gewählten Zeitraum mit einem Referenzzeitraum.
 */
const REFERENCE: Partial<Record<TimeRangeDto, TimeRangeDto>> = {
  ['short_term' as TimeRangeDto]: 'medium_term' as TimeRangeDto,
  ['medium_term' as TimeRangeDto]: 'long_term' as TimeRangeDto,
  ['long_term' as TimeRangeDto]: 'medium_term' as TimeRangeDto,
};

const RANGE_LABELS = new Map(RANGES.map((r) => [r.value, r.label]));

@Component({
  selector: 'app-dashboard-page',
  templateUrl: './dashboard.component.html',
  imports: [DatePipe],
})
export class DashboardComponent {
  private readonly api = inject(MeApi);
  private readonly listeningApi = inject(ListeningInsightsApi);
  private subscription?: Subscription;
  private listeningSubscription?: Subscription;

  protected readonly ranges = RANGES;
  protected readonly range = signal<TimeRangeDto>('medium_term' as TimeRangeDto);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly listeningLoading = signal(true);
  protected readonly listeningError = signal<string | null>(null);
  protected readonly listening = signal<ListeningInsights | null>(null);
  protected readonly weekdays = [
    'Montag',
    'Dienstag',
    'Mittwoch',
    'Donnerstag',
    'Freitag',
    'Samstag',
    'Sonntag',
  ];
  protected readonly heatmapRows = computed(() =>
    this.weekdays.map((label, weekday) => ({
      label,
      cells: (this.listening()?.heatmap ?? []).filter((cell) => cell.weekday === weekday),
    })),
  );
  protected readonly maxHeatCount = computed(() =>
    Math.max(1, ...(this.listening()?.heatmap ?? []).map((cell) => cell.count)),
  );
  protected readonly discovery = computed(() => this.listening()?.discovery ?? null);
  protected readonly streak = computed(() => this.listening()?.streak ?? null);

  private readonly current = signal<DashboardStats | null>(null);
  private readonly baseline = signal<DashboardStats | null>(null);

  protected readonly metrics = computed<Metric[]>(() => {
    const current = this.current();
    if (!current) {
      return [];
    }
    const baseline = this.baseline();
    return [
      this.metric('Streams', current.streams, baseline?.streams),
      this.metric('Minuten', current.minutes, baseline?.minutes),
      this.metric('Insgesamt angehörte Songs', current.songs, baseline?.songs),
      this.metric('Verschiedene Künstler', current.artists, baseline?.artists),
    ];
  });

  protected readonly genres = computed(() => this.current()?.genres ?? []);

  protected readonly topGenreCount = computed(() =>
    Math.max(1, ...this.genres().map((genre) => genre.count)),
  );

  protected readonly referenceLabel = computed(() => {
    const reference = REFERENCE[this.range()];
    return reference
      ? `Veränderung zu „${RANGE_LABELS.get(reference)}“`
      : 'Kein Vergleichszeitraum vorhanden';
  });

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.subscription?.unsubscribe();
      this.listeningSubscription?.unsubscribe();
    });
    this.load();
  }

  protected select(range: TimeRangeDto): void {
    if (range !== this.range()) {
      this.range.set(range);
      this.load();
    }
  }

  protected load(): void {
    this.subscription?.unsubscribe(); // schnelles Umschalten soll keine alte Antwort anzeigen
    this.listeningSubscription?.unsubscribe();
    this.loadListeningInsights();
    this.loading.set(true);
    this.error.set(null);

    const range = this.range();
    const reference = REFERENCE[range];

    this.subscription = forkJoin({
      tracks: this.api.getTopMeTopItemTypeGet({
        itemType: 'tracks' as TopItemTypeDto,
        limit: 50,
        offset: 0,
        timeRange: range,
      }),
      artists: this.api.getTopMeTopItemTypeGet({
        itemType: 'artists' as TopItemTypeDto,
        limit: 50,
        offset: 0,
        timeRange: range,
      }),
      referenceTracks: reference
        ? this.api.getTopMeTopItemTypeGet({
            itemType: 'tracks' as TopItemTypeDto,
            limit: 50,
            offset: 0,
            timeRange: reference,
          })
        : of(null),
      referenceArtists: reference
        ? this.api.getTopMeTopItemTypeGet({
            itemType: 'artists' as TopItemTypeDto,
            limit: 50,
            offset: 0,
            timeRange: reference,
          })
        : of(null),
    }).subscribe({
      next: ({ tracks, artists, referenceTracks, referenceArtists }) => {
        this.current.set(
          computeStats((tracks as TrackPagingDto).items, (artists as ArtistPagingDto).items),
        );
        this.baseline.set(
          referenceTracks && referenceArtists
            ? computeStats(
                (referenceTracks as TrackPagingDto).items,
                (referenceArtists as ArtistPagingDto).items,
              )
            : null,
        );
        this.loading.set(false);
      },
      error: (err: unknown) => {
        this.error.set(errorMessage(err));
        this.loading.set(false);
      },
    });
  }

  private loadListeningInsights(): void {
    this.listeningLoading.set(true);
    this.listeningError.set(null);
    this.listeningSubscription = this.listeningApi.get(this.range()).subscribe({
      next: (result) => {
        this.listening.set(result);
        this.listeningLoading.set(false);
      },
      error: (err: unknown) => {
        this.listeningError.set(errorMessage(err));
        this.listeningLoading.set(false);
      },
    });
  }

  protected heatOpacity(cell: ListeningHeatmapCell): number {
    return cell.count === 0 ? 0.06 : 0.18 + (cell.count / this.maxHeatCount()) * 0.82;
  }

  protected heatTitle(cell: ListeningHeatmapCell): string {
    return `${this.weekdays[cell.weekday]}, ${String(cell.hour).padStart(2, '0')}:00 Uhr – ${cell.count} ${cell.count === 1 ? 'Track' : 'Tracks'}`;
  }

  protected formatRate(rate: number | null | undefined): string {
    return rate == null ? '–' : `${rate.toLocaleString('de-DE', { maximumFractionDigits: 1 })} %`;
  }

  protected formatPercentagePoints(change: number | null | undefined): string {
    if (change == null) return 'Kein Vergleich';
    const sign = change > 0 ? '+' : change < 0 ? '−' : '';
    return `${sign}${Math.abs(change).toLocaleString('de-DE', { maximumFractionDigits: 1 })} Prozentpunkte`;
  }

  protected formatValue(value: number): string {
    return Math.round(value).toLocaleString('de-DE');
  }

  protected formatChange(change: number | null): string {
    if (change === null) {
      return '–';
    }
    const sign = change > 0 ? '+' : change < 0 ? '−' : '';
    const absolute = Math.abs(change).toLocaleString('de-DE', {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    });
    return `${sign}${absolute} %`;
  }

  protected barWidth(count: number): number {
    return Math.round((count / this.topGenreCount()) * 100);
  }

  protected genreLabel(count: number): string {
    return count === 1 ? '1 Künstler' : `${count.toLocaleString('de-DE')} Künstler`;
  }

  private metric(label: string, value: number, baseline: number | undefined): Metric {
    return {
      label,
      value: this.formatValue(value),
      change:
        baseline === undefined || baseline === 0 ? null : ((value - baseline) / baseline) * 100,
    };
  }
}

function computeStats(tracks: SpotifyTrackDto[], artists: SpotifyArtistDto[]): DashboardStats {
  const durations = tracks.reduce((sum, track) => sum + track.duration_ms, 0);

  // Spotify hat keinen Stream-Zähler. Wir gewichten die Top-Tracks mit ihrem
  // Popularitätswert (0–100) und skalieren auf eine plausible Größenordnung.
  const streams = tracks.reduce((sum, track) => sum + Math.max(1, track.popularity), 0) * 100;

  const songIds = new Set(tracks.map((track) => track.id));
  const artistIds = new Set<string>();
  for (const track of tracks) {
    for (const artist of track.artists ?? []) {
      artistIds.add(artist.id);
    }
  }
  for (const artist of artists) {
    artistIds.add(artist.id);
  }

  const genreCounts = new Map<string, number>();
  for (const artist of artists) {
    for (const genre of new Set(artist.genres ?? [])) {
      genreCounts.set(genre, (genreCounts.get(genre) ?? 0) + 1);
    }
  }
  const genres = [...genreCounts]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'de'))
    .slice(0, 5);

  return {
    streams,
    minutes: Math.round(durations / 60_000),
    songs: songIds.size,
    artists: artistIds.size,
    genres,
  };
}
