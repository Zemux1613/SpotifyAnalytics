import { Component, DestroyRef, inject, signal } from '@angular/core';
import { Subscription } from 'rxjs';
import { TracksApi, SpotifyTrackDto, TrackDetailsResponseDto } from '../api/generated';
import { errorMessage } from '../core/http-error';
import { pickImage } from '../core/images';
import { TrackDetailsComponent } from '../search/track-details/track-details.component';

@Component({
  selector: 'app-audio-analysis-page',
  imports: [TrackDetailsComponent],
  templateUrl: './audio-analysis.component.html',
})
export class AudioAnalysisComponent {
  private readonly api = inject(TracksApi);
  private searchSub?: Subscription;
  private detailsSub?: Subscription;

  protected readonly query = signal('');
  protected readonly results = signal<SpotifyTrackDto[] | null>(null);
  protected readonly selectedId = signal<string | null>(null);
  protected readonly details = signal<TrackDetailsResponseDto | null>(null);
  protected readonly searching = signal(false);
  protected readonly loadingDetails = signal(false);
  protected readonly searchError = signal<string | null>(null);
  protected readonly detailsError = signal<string | null>(null);
  protected readonly lastQuery = signal('');
  protected readonly image = pickImage;

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.searchSub?.unsubscribe();
      this.detailsSub?.unsubscribe();
    });
  }

  protected onInput(event: Event): void {
    this.query.set((event.target as HTMLInputElement).value);
  }

  protected search(event: Event): void {
    event.preventDefault();
    const query = this.query().trim();
    if (!query) return;

    this.searchSub?.unsubscribe();
    this.detailsSub?.unsubscribe();
    this.searching.set(true);
    this.searchError.set(null);
    this.detailsError.set(null);
    this.results.set(null);
    this.details.set(null);
    this.selectedId.set(null);
    this.lastQuery.set(query);

    this.searchSub = this.api.searchTracksTracksSearchGet({ q: query, limit: 10 }).subscribe({
      next: (response) => {
        const tracks = response.tracks.items.filter((track) => !!track);
        this.results.set(tracks);
        this.searching.set(false);
        if (tracks.length) this.select(tracks[0]);
      },
      error: (error: unknown) => {
        this.searchError.set(errorMessage(error));
        this.searching.set(false);
      },
    });
  }

  protected select(track: SpotifyTrackDto): void {
    this.detailsSub?.unsubscribe();
    this.selectedId.set(track.id);
    this.details.set(null);
    this.detailsError.set(null);
    this.loadingDetails.set(true);

    this.detailsSub = this.api.getTrackTracksTrackIdGet({ trackId: track.id }).subscribe({
      next: (details) => {
        this.details.set(details);
        this.loadingDetails.set(false);
      },
      error: (error: unknown) => {
        this.detailsError.set(errorMessage(error));
        this.loadingDetails.set(false);
      },
    });
  }

  protected artistNames(track: SpotifyTrackDto): string {
    return (track.artists ?? []).map((artist) => artist.name).join(', ');
  }
}
