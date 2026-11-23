import { Component, computed, DestroyRef, inject, signal } from '@angular/core';
import { forkJoin, Subscription } from 'rxjs';
import { errorMessage } from '../core/http-error';
import { pickImage } from '../core/images';
import {
  ArtistPagingDto,
  MeApi,
  SpotifyArtistDto,
  SpotifyTrackDto,
  TimeRangeDto,
  TopItemTypeDto,
  TrackPagingDto,
} from '../api/generated';
import { DurationPipe } from '@shared/duration.pipe';
import { InspectorService } from '@shared/services/inspector.service';

const RANGES: { value: TimeRangeDto; label: string }[] = [
  { value: 'short_term' as TimeRangeDto, label: 'Letzte 4 Wochen' },
  { value: 'medium_term' as TimeRangeDto, label: 'Letzte 6 Monate' },
  { value: 'long_term' as TimeRangeDto, label: 'Letztes Jahr' },
];

export interface RankedTrack {
  rank: number;
  track: SpotifyTrackDto;
  isHiddenGem: boolean;
}

@Component({
  selector: 'app-top-page',
  imports: [DurationPipe],
  templateUrl: './top.component.html',
  styleUrl: './top.component.scss',
})
export class TopComponent {
  private readonly api = inject(MeApi);
  private subscription?: Subscription;

  protected readonly inspector = inject(InspectorService);

  protected readonly ranges = RANGES;
  protected readonly range = signal<TimeRangeDto>('medium_term' as TimeRangeDto);
  protected readonly artists = signal<SpotifyArtistDto[]>([]);
  protected readonly tracks = signal<SpotifyTrackDto[]>([]);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly showAllArtists = signal(false);
  protected readonly showAllTracks = signal(false);
  protected readonly onlyHiddenGems = signal(false);

  // Prüft, ob die Spotify API gültige Popularity-Werte liefert (Schutz gegen Deprecated-Nullen)
  protected readonly hasPopularityData = computed(() =>
    this.tracks().some((track) => (track.popularity ?? 0) > 0)
  );

  // Feature 1: Mainstream- vs. Nischen-Score für den Header
  protected readonly tasteScore = computed(() => {
    if (!this.hasPopularityData()) return null;

    const values = this.tracks()
      .map((track) => track.popularity)
      .filter((p): p is number => typeof p === 'number' && p > 0);

    if (values.length === 0) return null;

    const avg = Math.round(values.reduce((sum, val) => sum + val, 0) / values.length);

    let label = 'Ausgewogener Mix';
    if (avg <= 35) label = 'Deep Underground';
    else if (avg <= 65) label = 'Ausgewogener Mix';
    else if (avg <= 84) label = 'Puls der Zeit';
    else label = 'Chart-Stürmer';

    return { avg, label };
  });

  // Behält den echten Rang (#1..#25), auch wenn gefiltert wird
  protected readonly rankedTracks = computed<RankedTrack[]>(() => {
    const valid = this.hasPopularityData();
    const mapped = this.tracks().map((track, idx) => ({
      rank: idx + 1,
      track,
      isHiddenGem: valid && (track.popularity ?? 100) < 45,
    }));

    return this.onlyHiddenGems() ? mapped.filter((item) => item.isHiddenGem) : mapped;
  });

  protected readonly hiddenGemCount = computed(() => {
    if (!this.hasPopularityData()) return 0;
    return this.tracks().filter((t) => (t.popularity ?? 100) < 45).length;
  });

  protected readonly visibleArtists = computed(() =>
    this.showAllArtists() ? this.artists() : this.artists().slice(0, 10)
  );

  protected readonly visibleTracks = computed(() =>
    this.showAllTracks() ? this.rankedTracks() : this.rankedTracks().slice(0, 10)
  );

  constructor() {
    inject(DestroyRef).onDestroy(() => this.subscription?.unsubscribe());
    this.load();
  }

  protected select(range: TimeRangeDto): void {
    if (range !== this.range()) {
      this.range.set(range);
      this.load();
    }
  }

  protected load(): void {
    this.subscription?.unsubscribe();
    this.loading.set(true);
    this.error.set(null);

    this.subscription = forkJoin({
      artists: this.api.getTopMeTopItemTypeGet({
        itemType: 'artists' as TopItemTypeDto,
        limit: 50,
        offset: 0,
        timeRange: this.range(),
      }),
      tracks: this.api.getTopMeTopItemTypeGet({
        itemType: 'tracks' as TopItemTypeDto,
        limit: 50,
        offset: 0,
        timeRange: this.range(), // <-- Bugfix: jetzt wechseln Tracks beim Zeitraum-Klick mit!
      }),
    }).subscribe({
      next: ({ artists, tracks }) => {
        this.artists.set((artists as ArtistPagingDto).items);
        this.tracks.set((tracks as TrackPagingDto).items);
        this.loading.set(false);
      },
      error: (err: unknown) => {
        this.error.set(errorMessage(err));
        this.loading.set(false);
      },
    });
  }

  protected image = pickImage;

  protected genres(artist: SpotifyArtistDto): string {
    return (artist.genres ?? []).slice(0, 3).join(', ');
  }

  protected artistNames(track: SpotifyTrackDto): string {
    return (track.artists ?? []).map((a) => a.name).join(', ');
  }

  protected inspect(track: SpotifyTrackDto): void {
    this.inspector.showTrack(track);
  }
}