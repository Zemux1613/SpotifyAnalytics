import { Component, DestroyRef, effect, inject, input, signal } from '@angular/core';
import { catchError, filter, map, of, Subscription, switchMap, take, timer } from 'rxjs';
import { errorMessage } from '../../../core/http-error';
import { PlaylistSuggestionDto, PlaylistSuggestionsResponseDto, SpotifyTrackDto, TracksApi, PlaylistsApi } from '../../../api/generated';
import { MatchEvidenceComponent } from '../match-evidence/match-evidence.component';

const AUDIO_POLL_LIMIT = 12;
const AUDIO_POLL_MS = 2000;
/** So viele Abfragen lang gilt „unavailable“ noch als „Analyse wurde noch nicht gestartet“. */
const AUDIO_NOT_STARTED_GRACE = 3;

@Component({
  selector: 'app-playlist-suggestions',
  imports: [MatchEvidenceComponent],
  templateUrl: './playlist-suggestions.component.html',
  styleUrl: './playlist-suggestions.component.scss'
})
export class PlaylistSuggestionsComponent {
  private readonly tracksApi = inject(TracksApi);
  private readonly playlistsApi = inject(PlaylistsApi);
  private suggestionsSub?: Subscription;
  private addSub?: Subscription;
  private audioSub?: Subscription;

  readonly track = input.required<SpotifyTrackDto>();

  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly response = signal<PlaylistSuggestionsResponseDto | null>(null);
  protected readonly addingId = signal<string | null>(null);
  protected readonly addedIds = signal<ReadonlySet<string>>(new Set());
  protected readonly addErrors = signal<Readonly<Record<string, string>>>({});
  /** true, solange auf die Audio-Analyse gewartet wird (BPM-/Stimmungs-Gründe fehlen noch) */
  protected readonly audioPending = signal(false);

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.suggestionsSub?.unsubscribe();
      this.addSub?.unsubscribe();
      this.audioSub?.unsubscribe();
    });

    effect(() => {
      const trackId = this.track().id;
      this.load(trackId);
    });
  }

  protected reload(): void {
    this.load(this.track().id, true);
  }

  protected add(suggestion: PlaylistSuggestionDto): void {
    if (this.addingId() || this.isAdded(suggestion)) {
      return;
    }
    this.addSub?.unsubscribe();
    this.addingId.set(suggestion.playlist_id);
    this.clearAddError(suggestion.playlist_id);

    this.addSub = this.playlistsApi.addTrackToPlaylistPlaylistsPlaylistIdTracksPost({
      playlistId: suggestion.playlist_id,
      addTrackRequestDto: { track_uri: this.track().uri },
    }).subscribe({
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

  protected isAdded(suggestion: PlaylistSuggestionDto): boolean {
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
    this.audioSub?.unsubscribe();
    this.audioPending.set(false);
    this.loading.set(true);
    this.error.set(null);
    this.response.set(null);
    this.addedIds.set(new Set());
    this.addErrors.set({});
    this.addingId.set(null);

    this.suggestionsSub = this.tracksApi.playlistSuggestionsTracksTrackIdPlaylistSuggestionsGet({ trackId, refresh }).subscribe({
      next: (response) => {
        this.response.set(response);
        this.loading.set(false);
        if (!response.audio_ready && response.suggestions.length > 0) {
          this.watchAudio(trackId);
        }
      },
      error: (err: unknown) => {
        this.error.set(errorMessage(err));
        this.loading.set(false);
      },
    });
  }

  /**
   * Die Audio-Analyse läuft parallel zu den Vorschlägen. Sobald sie fertig ist, werden die
   * Vorschläge still nachgeladen, damit „BPM passt“ / „Stimmung passt“ erscheinen.
   */
  private watchAudio(trackId: string): void {
    this.audioSub?.unsubscribe();
    this.audioPending.set(true);

    this.audioSub = timer(AUDIO_POLL_MS, AUDIO_POLL_MS).pipe(
      take(AUDIO_POLL_LIMIT),
      switchMap((attempt) =>
        this.tracksApi.getTrackAudioAnalysis({ trackId }).pipe(
          map((result) => ({ attempt, status: result.status })),
          catchError(() => of({ attempt, status: 'failed' as const })),
        ),
      ),
      filter(
        ({ attempt, status }) =>
          status === 'completed' ||
          status === 'failed' ||
          (status === 'unavailable' && attempt >= AUDIO_NOT_STARTED_GRACE),
      ),
      take(1),
    ).subscribe({
      next: ({ status }) => {
        this.audioPending.set(false);
        if (status === 'completed') {
          this.refreshQuietly(trackId);
        }
      },
      complete: () => this.audioPending.set(false),
    });
  }

  private refreshQuietly(trackId: string): void {
    this.suggestionsSub?.unsubscribe();
    this.suggestionsSub = this.tracksApi
      .playlistSuggestionsTracksTrackIdPlaylistSuggestionsGet({ trackId })
      .subscribe({ next: (response) => this.response.set(response) });
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
