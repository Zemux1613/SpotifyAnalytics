import { Component, DestroyRef, inject, signal } from '@angular/core';
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

const RANGES: { value: TimeRangeDto; label: string }[] = [
  { value: 'short_term' as TimeRangeDto, label: 'Letzte 4 Wochen' },
  { value: 'medium_term' as TimeRangeDto, label: 'Letzte 6 Monate' },
  { value: 'long_term' as TimeRangeDto, label: 'Letztes Jahr' },
];

@Component({
  selector: 'app-top-page',
  imports: [DurationPipe],
  templateUrl: './top.component.html',
})
export class TopComponent {
  private readonly api = inject(MeApi);
  private subscription?: Subscription;

  protected readonly ranges = RANGES;
  protected readonly range = signal<TimeRangeDto>('medium_term' as TimeRangeDto);
  protected readonly artists = signal<SpotifyArtistDto[]>([]);
  protected readonly tracks = signal<SpotifyTrackDto[]>([]);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);

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
    this.subscription?.unsubscribe(); // schnelles Umschalten soll keine alte Antwort anzeigen
    this.loading.set(true);
    this.error.set(null);

    this.subscription = forkJoin({
      artists: this.api.getTopMeTopItemTypeGet({
        itemType: 'artists' as TopItemTypeDto,
        limit: 25,
        offset: 0,
        timeRange: this.range(),
      }),
      tracks: this.api.getTopMeTopItemTypeGet({
        itemType: 'tracks' as TopItemTypeDto,
        limit: 25,
        offset: 0,
        timeRange: this.range(),
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
}
