import { Component, DestroyRef, inject, signal } from '@angular/core';
import { Subscription } from 'rxjs';
import { errorMessage } from '../core/http-error';
import { pickImage } from '../core/images';
import { SpotifyTrackDto, TracksApi } from '../api/generated';
import { InspectorService } from '@shared/services/inspector.service';

@Component({
  selector: 'app-search-page',
  templateUrl: './search.component.html',
  styleUrl: './search.component.scss'
})
export class SearchComponent {
  private readonly api = inject(TracksApi);
  private searchSub?: Subscription;

  protected readonly inspector = inject(InspectorService);

  protected readonly query = signal('');
  protected readonly lastQuery = signal('');
  /** null: es wurde noch nicht gesucht */
  protected readonly results = signal<SpotifyTrackDto[] | null>(null);
  protected readonly searching = signal(false);
  protected readonly searchError = signal<string | null>(null);

  constructor() {
    inject(DestroyRef).onDestroy(() => this.searchSub?.unsubscribe());
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
    this.searching.set(true);
    this.searchError.set(null);
    this.lastQuery.set(query);

    this.searchSub = this.api.searchTracksTracksSearchGet({ q: query, limit: 10 }).subscribe({
      next: (response) => {
        const items = response.tracks.items.filter((track) => !!track);
        this.results.set(items);
        this.searching.set(false);
      },
      error: (err: unknown) => {
        this.searchError.set(errorMessage(err));
        this.searching.set(false);
      },
    });
  }

  protected select(track: SpotifyTrackDto): void {
    this.inspector.showTrack(track);
  }

  protected artistNames(track: SpotifyTrackDto): string {
    return (track.artists ?? []).map((a) => a.name).join(', ');
  }
}
