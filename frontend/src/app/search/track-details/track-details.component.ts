import { DecimalPipe, JsonPipe } from '@angular/common';
import { Component, computed, DestroyRef, effect, inject, input, signal } from '@angular/core';
import {Observable, Subscription, switchMap, takeWhile, timer } from 'rxjs';
import { pickImage } from '../../core/images';
import { AudioAnalysisResponseDto, SpotifyArtistDto, TrackDetailsResponseDto, TracksApi } from '../../api/generated';
import { formatDuration, formatReleaseDate } from '@shared/format';

const ALBUM_TYPES: Record<string, string> = {
  album: 'Album',
  single: 'Single',
  compilation: 'Compilation',
};

interface Fact {
  label: string;
  value: string;
}

@Component({
  selector: 'app-track-details',
  imports: [DecimalPipe, JsonPipe],
  templateUrl: './track-details.component.html',
})
export class TrackDetailsComponent {
  private readonly tracksApi = inject(TracksApi);
  private analysisSub?: Subscription;

  readonly data = input.required<TrackDetailsResponseDto>();

  protected readonly track = computed(() => this.data().track);
  protected readonly audioAnalysis = signal<AudioAnalysisResponseDto | null>(null);
  protected readonly audioError = signal<string | null>(null);
  protected readonly audioLoading = signal(false);
  protected readonly radarPoints = computed(() => {
    const radar = this.audioAnalysis()?.features?.radar;
    if (!radar) return '';
    const values = [radar.tempo, radar.brightness, radar.rhythm, radar.texture];
    return values.map((value, index) => {
      const angle = (-90 + index * 90) * Math.PI / 180;
      const radius = value * 0.75;
      return `${120 + Math.cos(angle) * radius},${120 + Math.sin(angle) * radius}`;
    }).join(' ');
  });
  protected readonly cover = computed(() => pickImage(this.track().album.images, 440));
  protected readonly artistNames = computed(() =>
    (this.track().artists ?? []).map((a) => a.name).join(', '),
  );

  constructor() {
    const destroyRef = inject(DestroyRef);
    destroyRef.onDestroy(() => this.analysisSub?.unsubscribe());
    effect(() => {
      this.track().id;
      this.loadAudioAnalysis();
    });
  }

  protected readonly facts = computed<Fact[]>(() => {
    const t = this.track();
    const facts: Fact[] = [
      { label: 'Dauer', value: formatDuration(t.duration_ms) },
      {
        label: 'Veröffentlicht',
        value: formatReleaseDate(t.album.release_date, t.album.release_date_precision),
      },
      { label: 'Albumtyp', value: ALBUM_TYPES[t.album.album_type] ?? t.album.album_type },
      { label: 'Position', value: `Titel ${t.track_number} von ${t.album.total_tracks}` },
    ];
    if (t.disc_number > 1) {
      facts.push({ label: 'Disc', value: String(t.disc_number) });
    }
    if (t.external_ids?.isrc) {
      facts.push({ label: 'ISRC', value: t.external_ids.isrc });
    }
    facts.push({ label: 'Spotify-ID', value: t.id }, { label: 'Spotify-URI', value: t.uri });
    return facts;
  });

  private loadAudioAnalysis(): void {
    this.analysisSub?.unsubscribe();
    this.audioAnalysis.set(null);
    this.audioError.set(null);
    this.audioLoading.set(true);
    const trackId :string = this.track().id;

    this.analysisSub = this.tracksApi.startTrackAudioAnalysis({ trackId }).pipe(
      switchMap((initial :AudioAnalysisResponseDto) => {
        if (initial.status !== 'queued' && initial.status !== 'processing') {
          return [initial];
        }
        return timer(0, 1500).pipe(
          switchMap(():Observable<AudioAnalysisResponseDto> => this.tracksApi.getTrackAudioAnalysis({ trackId })),
          takeWhile((result:AudioAnalysisResponseDto) => result.status === 'queued' || result.status === 'processing', true),
        );
      }),
    ).subscribe({
      next: (result : AudioAnalysisResponseDto) => {
        this.audioAnalysis.set(result);
        this.audioLoading.set(result.status === 'queued' || result.status === 'processing');
      },
      error: () => {
        this.audioError.set('Die Audio-Analyse konnte nicht geladen werden.');
        this.audioLoading.set(false);
      },
    });
  }

  protected avatar(artist: SpotifyArtistDto): string | undefined {
    return pickImage(artist.images, 112);
  }

  protected genres(artist: SpotifyArtistDto): string {
    return (artist.genres ?? []).join(', ');
  }
}
