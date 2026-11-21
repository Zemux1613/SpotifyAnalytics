import { Component, computed, DestroyRef, inject, signal } from '@angular/core';
import { DatePipe, NgTemplateOutlet } from '@angular/common';
import { EMPTY, forkJoin, from, of, Subscription, timer } from 'rxjs';
import { catchError, concatMap, switchMap, take, takeWhile, tap, toArray } from 'rxjs/operators';
import { errorMessage } from '../core/http-error';
import { SparklineComponent } from '@shared/components/sparkline/sparkline.component';
import {
  ArtistPagingDto,
  MeApi,
  SpotifyArtistDto,
  SpotifyTrackDto,
  TimeRangeDto,
  TopItemTypeDto,
  TrackPagingDto,
} from '../api/generated';
import { DashboardKpiApi } from './dashboard-kpi.api';
import { AudioSummaryTrack, ModelStatus } from './dashboard-kpi.model';
import { DashboardStats, Metric } from './dashboard.model';
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

const BPM_SAMPLE = 8; // so viele Top-Tracks fließen in den Ø-BPM ein
const BPM_POLL_MS = 2500;
const BPM_POLL_LIMIT = 60; // ~2,5 Minuten, danach bleibt der letzte Stand stehen

const isPending = (track: AudioSummaryTrack) =>
  track.status === 'queued' || track.status === 'processing';

function formatMinutes(minutes: number): string {
  const total = Math.round(minutes);
  if (total < 60) return `${total} Min`;
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  return rest === 0 ? `${hours} Std` : `${hours} Std ${rest} Min`;
}

function dayLabel(isoDate: string): string {
  return new Date(`${isoDate}T00:00:00`).toLocaleDateString('de-DE', {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
  });
}

@Component({
  selector: 'app-dashboard-page',
  templateUrl: './dashboard.component.html',
  imports: [DatePipe, NgTemplateOutlet, SparklineComponent],
  styleUrl: './dashboard.component.scss'
})
export class DashboardComponent {
  private readonly api = inject(MeApi);
  private readonly listeningApi = inject(ListeningInsightsApi);
  private readonly kpiApi = inject(DashboardKpiApi);
  private subscription?: Subscription;
  private listeningSubscription?: Subscription;
  private bpmSubscription?: Subscription;
  private modelSubscription?: Subscription;
  private topTrackIds: string[] = [];

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

  // ---------- KPI: Hörzeit ----------
  protected readonly formatMinutes = formatMinutes;
  protected readonly formatTracks = (count: number) => (count === 1 ? '1 Track' : `${count} Tracks`);
  protected readonly listeningView = computed<'loading' | 'error' | 'empty' | 'ready'>(() => {
    if (this.listeningLoading()) return 'loading';
    if (this.listeningError()) return 'error';
    return (this.listening()?.sample_size ?? 0) === 0 ? 'empty' : 'ready';
  });
  protected readonly daily = computed(() => this.listening()?.daily ?? []);
  protected readonly hasListeningTime = computed(() => this.daily().some((d) => d.minutes > 0));
  protected readonly todayMinutes = computed(() => this.daily().at(-1)?.minutes ?? 0);
  protected readonly todayPlays = computed(() => this.daily().at(-1)?.plays ?? 0);
  protected readonly todayDelta = computed(() => {
    const days = this.daily();
    return days.length < 2 ? null : days[days.length - 1].minutes - days[days.length - 2].minutes;
  });
  protected readonly dailyValues = computed(() => this.daily().map((d) => d.minutes));
  protected readonly dailyLabels = computed(() => this.daily().map((d) => dayLabel(d.date)));
  protected readonly dailyPlays = computed(() => this.daily().map((d) => d.plays));
  private readonly lastSevenDays = computed(() => this.daily().slice(-7));
  protected readonly weekValues = computed(() => this.lastSevenDays().map((d) => d.minutes));
  protected readonly weekLabels = computed(() => this.lastSevenDays().map((d) => dayLabel(d.date)));
  protected readonly weekMinutes = computed(() => this.weekValues().reduce((a, b) => a + b, 0));
  protected readonly weekChange = computed(() => {
    const previous = this.daily()
      .slice(-14, -7)
      .reduce((sum, d) => sum + d.minutes, 0);
    return previous > 0 ? ((this.weekMinutes() - previous) / previous) * 100 : null;
  });

  // ---------- KPI: Top-Genre ----------
  protected readonly topGenre = computed(() => this.genres()[0] ?? null);
  protected readonly genreSparkValues = computed(() => this.genres().map((g) => g.count));
  protected readonly genreSparkLabels = computed(() => this.genres().map((g) => g.name));

  // ---------- KPI: Ø-BPM ----------
  protected readonly bpmTracks = signal<AudioSummaryTrack[]>([]);
  protected readonly bpmLoading = signal(false);
  protected readonly bpmRunning = signal(false);
  protected readonly bpmError = signal<string | null>(null);
  private readonly trackNames = signal<Record<string, string>>({});
  private readonly bpmCompleted = computed(() =>
    this.bpmTracks().filter((t) => t.status === 'completed' && t.tempo_bpm != null),
  );
  protected readonly bpmValues = computed(() => this.bpmCompleted().map((t) => t.tempo_bpm as number));
  protected readonly bpmLabels = computed(() =>
    this.bpmCompleted().map((t) => this.trackNames()[t.track_id] ?? ''),
  );
  protected readonly avgBpm = computed(() => {
    const values = this.bpmValues();
    return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
  });
  protected readonly bpmPending = computed(() => this.bpmTracks().filter(isPending).length);
  protected readonly bpmUnavailable = computed(
    () => this.bpmTracks().filter((t) => t.status === 'unavailable').length,
  );
  protected readonly bpmTodo = computed(
    () => this.bpmTracks().filter((t) => t.status === 'not_started' || t.status === 'failed').length,
  );
  protected readonly formatBpm = (value: number) => `${Math.round(value)} BPM`;

  // ---------- KPI: Modell-Status ----------
  protected readonly modelStatus = signal<ModelStatus | null>(null);
  protected readonly modelLoading = signal(true);
  protected readonly modelTraining = signal(false);
  protected readonly modelError = signal<string | null>(null);
  protected readonly modelState = computed<'ready' | 'sparse' | 'untrained'>(() => {
    const status = this.modelStatus();
    if (!status?.trained || !status.model) return 'untrained';
    return status.model.playlists_trained === 0 ? 'sparse' : 'ready';
  });
  protected readonly modelCoverage = computed(() => {
    const model = this.modelStatus()?.model;
    return model && model.playlists_total > 0
      ? Math.round((model.playlists_trained / model.playlists_total) * 100)
      : 0;
  });

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
      this.bpmSubscription?.unsubscribe();
      this.modelSubscription?.unsubscribe();
    });
    this.load();
    this.loadModelStatus();
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
    this.bpmSubscription?.unsubscribe();
    this.bpmTracks.set([]);
    this.bpmRunning.set(false);
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

        const top = (tracks as TrackPagingDto).items.slice(0, BPM_SAMPLE);
        this.topTrackIds = top.map((track) => track.id);
        this.trackNames.set(Object.fromEntries(top.map((track) => [track.id, track.name])));
        this.loadBpmSummary();
      },
      error: (err: unknown) => {
        this.error.set(errorMessage(err));
        this.loading.set(false);
      },
    });
  }

  // ---------- Ø-BPM: Summary laden, Analyse anstoßen, Fortschritt pollen ----------
  private loadBpmSummary(): void {
    if (this.topTrackIds.length === 0) return;
    this.bpmLoading.set(true);
    this.bpmError.set(null);
    this.bpmSubscription = this.kpiApi.audioSummary(this.topTrackIds).subscribe({
      next: (summary) => {
        this.bpmTracks.set(summary.tracks);
        this.bpmLoading.set(false);
        if (summary.tracks.some(isPending)) this.watchBpm(); // z. B. nach Neuladen während Analyse
      },
      error: (err: unknown) => {
        this.bpmError.set(errorMessage(err));
        this.bpmLoading.set(false);
      },
    });
  }

  private watchBpm(): void {
    this.bpmSubscription?.unsubscribe();
    this.bpmRunning.set(true);
    this.bpmSubscription = timer(0, BPM_POLL_MS)
      .pipe(
        switchMap(() => this.kpiApi.audioSummary(this.topTrackIds)),
        tap((summary) => this.bpmTracks.set(summary.tracks)),
        takeWhile((summary) => summary.tracks.some(isPending), true),
        take(BPM_POLL_LIMIT),
      )
      .subscribe({
        error: (err: unknown) => {
          this.bpmError.set(errorMessage(err));
          this.bpmRunning.set(false);
        },
        complete: () => this.bpmRunning.set(false),
      });
  }

  protected analyseTopTracks(): void {
    const todo = this.bpmTracks()
      .filter((t) => t.status === 'not_started' || t.status === 'failed')
      .map((t) => t.track_id);
    if (todo.length === 0 || this.bpmRunning()) return;

    this.bpmError.set(null);
    this.bpmRunning.set(true);
    this.bpmSubscription?.unsubscribe();
    // nacheinander starten: jeder Start lädt Track-Details bei Spotify (Rate-Limit schonen)
    this.bpmSubscription = from(todo)
      .pipe(
        concatMap((id) => this.kpiApi.startAudioAnalysis(id).pipe(catchError(() => EMPTY))),
        toArray(),
      )
      .subscribe({ complete: () => this.watchBpm() });
  }

  // ---------- Modell-Status ----------
  protected loadModelStatus(): void {
    this.modelSubscription?.unsubscribe();
    this.modelLoading.set(true);
    this.modelError.set(null);
    this.modelSubscription = this.kpiApi.modelStatus().subscribe({
      next: (status) => {
        this.modelStatus.set(status);
        this.modelLoading.set(false);
      },
      error: (err: unknown) => {
        this.modelError.set(errorMessage(err));
        this.modelLoading.set(false);
      },
    });
  }

  protected trainModel(): void {
    if (this.modelTraining()) return;
    this.modelSubscription?.unsubscribe();
    this.modelTraining.set(true);
    this.modelError.set(null);
    this.modelSubscription = this.kpiApi.trainModel().subscribe({
      next: (status) => {
        this.modelStatus.set(status);
        this.modelTraining.set(false);
      },
      error: (err: unknown) => {
        this.modelError.set(errorMessage(err));
        this.modelTraining.set(false);
      },
    });
  }

  protected formatAge(iso: string): string {
    const minutes = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
    if (minutes < 1) return 'gerade eben';
    return minutes < 60 ? `vor ${minutes} Min` : `vor ${Math.round(minutes / 60)} Std`;
  }

  protected formatExpiry(seconds: number | null): string {
    return seconds == null ? '' : `noch ${Math.max(1, Math.round(seconds / 60))} Min gültig`;
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

  protected formatDelta(minutes: number | null): string {
    if (minutes === null) return 'Kein Vergleich';
    if (Math.round(minutes) === 0) return 'Wie gestern';
    return `${minutes > 0 ? '+' : '−'}${formatMinutes(Math.abs(minutes))} zu gestern`;
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
