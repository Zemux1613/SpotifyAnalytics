import { Component, DestroyRef, inject, signal } from '@angular/core';
import { Subscription } from 'rxjs';
import { errorMessage } from '../core/http-error';
import { pickImage } from '../core/images';
import { SpotifyTrackDto, TrackDetailsResponseDto, TracksApi } from '../api/generated';
import { PlaylistSuggestionsComponent } from './playlist-suggestions/playlist-suggestions.component';
import { TrackDetailsComponent } from './track-details/track-details.component';

@Component({
  selector: 'app-search-page',
  imports: [TrackDetailsComponent, PlaylistSuggestionsComponent],
  templateUrl: './search.component.html',
  styleUrl: './search.component.scss'
})
export class SearchComponent {
  private readonly api = inject(TracksApi);
  private searchSub?: Subscription;
  private detailsSub?: Subscription;

  protected readonly query = signal('');
  protected readonly lastQuery = signal('');
  /** null: es wurde noch nicht gesucht */
  protected readonly results = signal<SpotifyTrackDto[] | null>(null);
  protected readonly searching = signal(false);
  protected readonly searchError = signal<string | null>(null);

  protected readonly selectedId = signal<string | null>(null);
  protected readonly details = signal<TrackDetailsResponseDto | null>(null);
  protected readonly loadingDetails = signal(false);
  protected readonly detailsError = signal<string | null>(null);

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.searchSub?.unsubscribe();
      this.detailsSub?.unsubscribe();
    });
  }

  protected image = pickImage;

  protected onInput(event: Event): void {
    this.query.set((event.target as HTMLInputElement).value);
  }

  protected search(event: Event): void {
    event.preventDefault();
    const query = this.query().trim();
    if (!query) {
      return;
    }

    this.searchSub?.unsubscribe();
    this.detailsSub?.unsubscribe();
    this.searching.set(true);
    this.searchError.set(null);
    this.lastQuery.set(query);
    this.selectedId.set(null);
    this.details.set(null);
    this.detailsError.set(null);
    this.loadingDetails.set(false);

    this.searchSub = this.api.searchTracksTracksSearchGet({ q: query, limit: 10 }).subscribe({
      next: (response) => {
        const items = response.tracks.items.filter((track) => !!track);
        this.results.set(items);
        this.searching.set(false);
        if (items.length > 0) {
          this.select(items[0]); // der beste Treffer wird gleich angezeigt
        }
      },
      error: (err: unknown) => {
        this.searchError.set(errorMessage(err));
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
      error: (err: unknown) => {
        this.detailsError.set(errorMessage(err));
        this.loadingDetails.set(false);
      },
    });
  }

  protected artistNames(track: SpotifyTrackDto): string {
    return (track.artists ?? []).map((a) => a.name).join(', ');
  }
}
