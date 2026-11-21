import { Component, DestroyRef, inject, signal } from '@angular/core';
import { forkJoin, Subscription } from 'rxjs';
import { errorMessage } from '../core/http-error';
import { pickImage } from '../core/images';
import { TimeRange } from '../core/models';
import { SpotifyArtist, SpotifyTrack } from '@shared/interfaces/Spotify';
import { SpotifyApiService } from '@shared/services/spotify-api.service';
import { DurationPipe } from '@shared/duration.pipe';

const RANGES: { value: TimeRange; label: string }[] = [
  { value: 'short_term', label: 'Letzte 4 Wochen' },
  { value: 'medium_term', label: 'Letzte 6 Monate' },
  { value: 'long_term', label: 'Letztes Jahr' },
];

@Component({
  selector: 'app-top-page',
  imports: [DurationPipe],
  templateUrl: './top.page.html',
})
export class TopPage {
  private readonly api = inject(SpotifyApiService);
  private subscription?: Subscription;

  protected readonly ranges = RANGES;
  protected readonly range = signal<TimeRange>('medium_term');
  protected readonly artists = signal<SpotifyArtist[]>([]);
  protected readonly tracks = signal<SpotifyTrack[]>([]);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);

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

    this.subscription = forkJoin({
      artists: this.api.topArtists(this.range()),
      tracks: this.api.topTracks(this.range()),
    }).subscribe({
      next: ({ artists, tracks }) => {
        this.artists.set(artists.items);
        this.tracks.set(tracks.items);
        this.loading.set(false);
      },
      error: (err: unknown) => {
        this.error.set(errorMessage(err));
        this.loading.set(false);
      },
    });
  }

  protected image = pickImage;

  protected genres(artist: SpotifyArtist): string {
    return (artist.genres ?? []).slice(0, 3).join(', ');
  }

  protected artistNames(track: SpotifyTrack): string {
    return track.artists.map((a) => a.name).join(', ');
  }
}
