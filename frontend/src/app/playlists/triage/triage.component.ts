import { DecimalPipe } from '@angular/common';
import { Component, computed, DestroyRef, ElementRef, HostListener, inject, output, signal, viewChild, AfterViewInit, OnInit } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Observable, of, switchMap, take, takeWhile, timer } from 'rxjs';
import {
  AudioAnalysisResponseDto,
  AudioRadarValuesDto,
  PlaylistSuggestionDto,
  PlaylistsApi,
  SpotifyTrackDto,
  TracksApi,
} from '../../api/generated';
import { errorMessage } from '../../core/http-error';
import { pickImage } from '../../core/images';
import { MatchEvidenceComponent } from '../../shared/components/match-evidence/match-evidence.component';
import { RadarChartComponent, RadarSeries } from '../../shared/components/radar-chart/radar-chart.component';

const QUEUE_LIMIT = 50;
const PREFETCH_AHEAD = 2;
const ANALYSIS_POLL_MS = 1500;
const ANALYSIS_POLL_LIMIT = 20;
const TOAST_MS = 5000;

type RadarState = 'loading' | 'ready' | 'unavailable';
type SuggestionState = 'loading' | 'ready' | 'error';

interface TrackCard {
  suggestionState: SuggestionState;
  /** die besten drei Playlists, in die der Song noch nicht gehört */
  options: PlaylistSuggestionDto[];
  audioReady: boolean;
  message: string | null;
  radarState: RadarState;
  radar: AudioRadarValuesDto | null;
  bpm: number | null;
  mood: string | null;
}

const EMPTY_CARD: TrackCard = {
  suggestionState: 'loading',
  options: [],
  audioReady: false,
  message: null,
  radarState: 'loading',
  radar: null,
  bpm: null,
  mood: null,
};

const isPending = (result: AudioAnalysisResponseDto) =>
  result.status === 'queued' || result.status === 'processing';

/**
 * Fokus-Modus für unsortierte Lieblingssongs: Cover, Radar und die Top-3-Playlists groß,
 * Zuordnung per Tastendruck (1/2/3/Enter), danach rückt der nächste Song nach.
 */
@Component({
  selector: 'app-triage',
  imports: [DecimalPipe, MatchEvidenceComponent, RadarChartComponent],
  templateUrl: './triage.component.html',
  styleUrl: './triage.component.scss',
})
export class TriageComponent implements OnInit, AfterViewInit {
  private readonly playlistsApi = inject(PlaylistsApi);
  private readonly tracksApi = inject(TracksApi);
  private readonly destroyRef = inject(DestroyRef);
  private readonly dialog = viewChild.required<ElementRef<HTMLElement>>('dialog');
  private readonly requested = new Set<string>();
  private toastTimer?: ReturnType<typeof setTimeout>;

  /** Wird beim Schließen gesendet, Wert = Anzahl zugeordneter Songs (für den Reload der Playlists). */
  readonly closed = output<number>();

  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly queue = signal<SpotifyTrackDto[]>([]);
  protected readonly totalUnsorted = signal(0);
  protected readonly index = signal(0);
  protected readonly sortedCount = signal(0);
  protected readonly skippedCount = signal(0);
  protected readonly cards = signal<Readonly<Record<string, TrackCard>>>({});
  protected readonly toast = signal<string | null>(null);
  protected readonly lastAssigned = signal<string | null>(null);

  protected readonly current = computed(() => this.queue()[this.index()] ?? null);
  protected readonly finished = computed(
    () => !this.loading() && !this.error() && this.index() >= this.queue().length,
  );
  protected readonly card = computed<TrackCard>(() => {
    const track = this.current();
    return (track && this.cards()[track.id]) || EMPTY_CARD;
  });
  protected readonly cover = computed(() => {
    const track = this.current();
    return track ? pickImage(track.album.images, 300) : undefined;
  });
  protected readonly artistNames = computed(() =>
    (this.current()?.artists ?? []).map((artist) => artist.name).join(', '),
  );
  protected readonly radarSeries = computed<RadarSeries[]>(() => {
    const radar = this.card().radar;
    return radar ? [{ label: this.current()?.name ?? 'Song', values: radar, tone: 'a' }] : [];
  });
  protected readonly progress = computed(() => {
    const total = this.queue().length;
    return total === 0 ? 0 : (this.index() / total) * 100;
  });

  ngOnInit(): void {
    this.destroyRef.onDestroy(() => clearTimeout(this.toastTimer));
    this.loadQueue();
  }

  ngAfterViewInit(): void {
    this.dialog().nativeElement.focus();
  }

  protected loadQueue(): void {
    this.loading.set(true);
    this.error.set(null);
    this.requested.clear();
    this.cards.set({});
    this.index.set(0);

    this.playlistsApi
      .getUnsortedTracks({ limit: QUEUE_LIMIT })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          this.queue.set(response.tracks);
          this.totalUnsorted.set(response.total_unsorted);
          this.loading.set(false);
          this.prefetch();
        },
        error: (err: unknown) => {
          this.error.set(errorMessage(err));
          this.loading.set(false);
        },
      });
  }

  // ---------- Tastatur ----------

  @HostListener('document:keydown', ['$event'])
  protected onKey(event: KeyboardEvent): void {
    if (event.ctrlKey || event.metaKey || event.altKey || event.repeat) {
      return;
    }
    switch (event.key) {
      case 'Escape':
        event.preventDefault();
        this.close();
        return;
      case '1':
      case '2':
      case '3':
        event.preventDefault();
        this.assign(Number(event.key) - 1);
        return;
      case 'Enter':
        // auf einem fokussierten Button gilt dessen eigene Aktion (z. B. Option 2 oder „Beenden“)
        if ((event.target as HTMLElement | null)?.closest('button')) {
          return;
        }
        event.preventDefault();
        this.assign(0);
        return;
      case 's':
      case 'S':
      case 'ArrowRight':
        event.preventDefault();
        this.skip();
        return;
    }
  }

  // ---------- Aktionen ----------

  protected assign(slot: number): void {
    const track = this.current();
    const target = this.card().options[slot];
    if (!track || !target) {
      return;
    }

    // Optimistisch weiter: der nächste Song erscheint sofort, der POST läuft im Hintergrund.
    this.sortedCount.update((count) => count + 1);
    this.lastAssigned.set(`${track.name} → ${target.name}`);
    this.advance();

    this.playlistsApi
      .addTrackToPlaylistPlaylistsPlaylistIdTracksPost({
        playlistId: target.playlist_id,
        addTrackRequestDto: { track_uri: track.uri },
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        error: (err: unknown) => {
          this.sortedCount.update((count) => Math.max(0, count - 1));
          this.queue.update((queue) => [...queue, track]); // landet am Ende wieder in der Queue
          this.showToast(`„${track.name}“ konnte nicht zu „${target.name}“ hinzugefügt werden: ${errorMessage(err)}`);
        },
      });
  }

  protected skip(): void {
    if (!this.current()) {
      return;
    }
    this.skippedCount.update((count) => count + 1);
    this.advance();
  }

  protected close(): void {
    this.closed.emit(this.sortedCount());
  }

  protected image(track: SpotifyTrackDto): string | undefined {
    return pickImage(track.album.images, 64);
  }

  private advance(): void {
    this.index.update((value) => value + 1);
    this.prefetch();
  }

  private showToast(message: string): void {
    clearTimeout(this.toastTimer);
    this.toast.set(message);
    this.toastTimer = setTimeout(() => this.toast.set(null), TOAST_MS);
  }

  // ---------- Daten pro Song (mit Vorausladen) ----------

  private prefetch(): void {
    const queue = this.queue();
    for (let i = this.index(); i <= this.index() + PREFETCH_AHEAD && i < queue.length; i++) {
      this.loadCard(queue[i].id);
    }
  }

  private patch(trackId: string, changes: Partial<TrackCard>): void {
    this.cards.update((cards) => ({ ...cards, [trackId]: { ...(cards[trackId] ?? EMPTY_CARD), ...changes } }));
  }

  private loadCard(trackId: string): void {
    if (this.requested.has(trackId)) {
      return;
    }
    this.requested.add(trackId);
    this.patch(trackId, {});
    this.fetchSuggestions(trackId);
    this.fetchAnalysis(trackId);
  }

  private fetchSuggestions(trackId: string): void {
    this.tracksApi
      .playlistSuggestionsTracksTrackIdPlaylistSuggestionsGet({ trackId })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) =>
          this.patch(trackId, {
            suggestionState: 'ready',
            options: response.suggestions.filter((s) => !s.already_in_playlist).slice(0, 3),
            audioReady: Boolean(response.audio_ready),
            message: response.message ?? null,
          }),
        error: (err: unknown) => this.patch(trackId, { suggestionState: 'error', message: errorMessage(err) }),
      });
  }

  private fetchAnalysis(trackId: string): void {
    this.tracksApi
      .startTrackAudioAnalysis({ trackId })
      .pipe(
        switchMap((initial): Observable<AudioAnalysisResponseDto> =>
          isPending(initial)
            ? timer(ANALYSIS_POLL_MS, ANALYSIS_POLL_MS).pipe(
                take(ANALYSIS_POLL_LIMIT),
                switchMap(() => this.tracksApi.getTrackAudioAnalysis({ trackId })),
                takeWhile(isPending, true),
              )
            : of(initial),
        ),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (result) => {
          if (isPending(result)) {
            return;
          }
          if (result.status === 'completed' && result.features) {
            this.patch(trackId, {
              radarState: 'ready',
              radar: result.features.radar,
              bpm: result.features.tempo_bpm,
              mood: result.features.mood,
            });
            // BPM-/Stimmungs-Gründe kommen erst mit fertiger Analyse: Vorschläge einmal still neu laden.
            if (!this.cards()[trackId]?.audioReady) {
              this.fetchSuggestions(trackId);
            }
          } else {
            this.patch(trackId, { radarState: 'unavailable' });
          }
        },
        error: () => this.patch(trackId, { radarState: 'unavailable' }),
        complete: () => {
          if (this.cards()[trackId]?.radarState === 'loading') {
            this.patch(trackId, { radarState: 'unavailable' });
          }
        },
      });
  }
}
