import { Component, DestroyRef, effect, inject, input, signal } from '@angular/core';
import { Subscription } from 'rxjs';
import { errorMessage } from '../../core/http-error';
import { SpotifyTrack } from '@shared/interfaces/Spotify';
import { PlaylistSuggestion, PlaylistSuggestionsResponse } from '@shared/interfaces/Playlist';
import { SpotifyApiService } from '@shared/services/spotify-api.service';

@Component({
  selector: 'app-playlist-suggestions',
  templateUrl: './playlist-suggestions.component.html',
})
export class PlaylistSuggestionsComponent {
  private readonly api = inject(SpotifyApiService);
  private suggestionsSub?: Subscription;
  private addSub?: Subscription;

  readonly track = input.required<SpotifyTrack>();

  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly response = signal<PlaylistSuggestionsResponse | null>(null);
  protected readonly addingId = signal<string | null>(null);
  protected readonly addedIds = signal<ReadonlySet<string>>(new Set());
  protected readonly addErrors = signal<Readonly<Record<string, string>>>({});

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.suggestionsSub?.unsubscribe();
      this.addSub?.unsubscribe();
    });

    effect(() => {
      const trackId = this.track().id;
      this.load(trackId);
    });
  }

  protected reload(): void {
    this.load(this.track().id, true);
  }

  protected add(suggestion: PlaylistSuggestion): void {
    if (this.addingId() || this.isAdded(suggestion)) {
      return;
    }
    this.addSub?.unsubscribe();
    this.addingId.set(suggestion.playlist_id);
    this.clearAddError(suggestion.playlist_id);

    this.addSub = this.api.addTrackToPlaylist(suggestion.playlist_id, this.track().uri).subscribe({
      next: () => {
        this.addedIds.set(new Set([...this.addedIds(), suggestion.playlist_id]));
        this.addingId.set(null);
      },
      error: (err: unknown) => {
        this.setAddError(suggestion.playlist_id, errorMessage(err));
        this.addingId.set(null);
      },
    });
  }

  protected isAdded(suggestion: PlaylistSuggestion): boolean {
    return suggestion.already_in_playlist || this.addedIds().has(suggestion.playlist_id);
  }

  protected addError(playlistId: string): string | undefined {
    return this.addErrors()[playlistId];
  }

  protected count(value: number): string {
    return value.toLocaleString('de-DE');
  }

  private load(trackId: string, refresh = false): void {
    this.suggestionsSub?.unsubscribe();
    this.loading.set(true);
    this.error.set(null);
    this.response.set(null);
    this.addedIds.set(new Set());
    this.addErrors.set({});
    this.addingId.set(null);

    this.suggestionsSub = this.api.playlistSuggestions(trackId, refresh).subscribe({
      next: (response) => {
        this.response.set(response);
        this.loading.set(false);
      },
      error: (err: unknown) => {
        this.error.set(errorMessage(err));
        this.loading.set(false);
      },
    });
  }

  private setAddError(playlistId: string, message: string): void {
    this.addErrors.set({ ...this.addErrors(), [playlistId]: message });
  }

  private clearAddError(playlistId: string): void {
    const errors = { ...this.addErrors() };
    delete errors[playlistId];
    this.addErrors.set(errors);
  }
}
