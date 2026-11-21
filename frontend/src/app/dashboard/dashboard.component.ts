import { Component, computed, DestroyRef, inject, signal } from '@angular/core';
import { forkJoin, of, Subscription } from 'rxjs';
import { errorMessage } from '../core/http-error';
import { TimeRange } from '../core/models';
import { SpotifyArtist, SpotifyTrack } from '@shared/interfaces/Spotify';
import { SpotifyApiService } from '@shared/services/spotify-api.service';
import { DashboardStats, Metric } from './dashboard.model.component';

const RANGES: { value: TimeRange; label: string }[] = [
  { value: 'short_term', label: 'Letzte 4 Wochen' },
  { value: 'medium_term', label: 'Letzte 6 Monate' },
  { value: 'long_term', label: 'Letztes Jahr' },
];

/**
 * Spotify liefert keine echten Stream-Zahlen oder Hörhistorien.
 * Deshalb vergleichen wir den gewählten Zeitraum mit einem Referenzzeitraum.
 */
const REFERENCE: Record<TimeRange, TimeRange | null> = {
  short_term: 'medium_term',
  medium_term: 'long_term',
  long_term: 'medium_term',
};

const RANGE_LABELS = new Map(RANGES.map((r) => [r.value, r.label]));

@Component({
  selector: 'app-dashboard-page',
  templateUrl: './dashboard.component.html',
})
export class DashboardComponent {
  private readonly api = inject(SpotifyApiService);
  private subscription?: Subscription;

  protected readonly ranges = RANGES;
  protected readonly range = signal<TimeRange>('medium_term');
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);

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
    inject(DestroyRef).onDestroy(() => this.subscription?.unsubscribe());
    this.load();
  }

  protected select(range: TimeRange): void {
    if (range !== this.range()) {
      this.range.set(range);
      this.load();
    }
  }

  protected load(): void {
    this.subscription?.unsubscribe(); // schnelles Umschalten soll keine alte Antwort anzeigen
    this.loading.set(true);
    this.error.set(null);

    const range = this.range();
    const reference = REFERENCE[range];

    this.subscription = forkJoin({
      tracks: this.api.topTracks(range, 50),
      artists: this.api.topArtists(range, 50),
      referenceTracks: reference ? this.api.topTracks(reference, 50) : of(null),
      referenceArtists: reference ? this.api.topArtists(reference, 50) : of(null),
    }).subscribe({
      next: ({ tracks, artists, referenceTracks, referenceArtists }) => {
        this.current.set(computeStats(tracks.items, artists.items));
        this.baseline.set(
          referenceTracks && referenceArtists
            ? computeStats(referenceTracks.items, referenceArtists.items)
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

function computeStats(tracks: SpotifyTrack[], artists: SpotifyArtist[]): DashboardStats {
  const durations = tracks.reduce((sum, track) => sum + track.duration_ms, 0);

  // Spotify hat keinen Stream-Zähler. Wir gewichten die Top-Tracks mit ihrem
  // Popularitätswert (0–100) und skalieren auf eine plausible Größenordnung.
  const streams = tracks.reduce((sum, track) => sum + Math.max(1, track.popularity), 0) * 100;

  const songIds = new Set(tracks.map((track) => track.id));
  const artistIds = new Set<string>();
  for (const track of tracks) {
    for (const artist of track.artists) {
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
