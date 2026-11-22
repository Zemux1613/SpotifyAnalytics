import { computed, inject, Injectable, signal } from '@angular/core';
import { Subscription, timer } from 'rxjs';
import { MeApi, NowPlayingResponseDto, NowPlayingTrackDto } from '../../api/generated';
import { InspectorTrack } from '../models/inspector.models';

const POLL_MS = 10_000;

/**
 * Fragt regelmäßig den aktuell auf Spotify laufenden Track ab. Solange der User
 * in der App keinen Track ausgewählt hat, zeigt die Now-Playing-Leiste diesen
 * Live-Track. Ein Klick auf einen Song "pinnt" ihn und pausiert die Anzeige.
 */
@Injectable({ providedIn: 'root' })
export class NowPlayingService {
  private readonly api = inject(MeApi);
  private pollSub?: Subscription;
  private running = false;

  readonly liveTrack = signal<InspectorTrack | null>(null);
  readonly isPlaying = signal(false);
  readonly progressMs = signal(0);
  readonly pinnedTrack = signal<InspectorTrack | null>(null);

  readonly displayTrack = computed(() => this.pinnedTrack() ?? this.liveTrack());
  readonly isPinned = computed(() => this.pinnedTrack() !== null);

  private readonly onVisibilityChange = (): void => {
    if (document.visibilityState === 'visible') {
      this.poll();
    }
  };

  start(): void {
    if (this.running) {
      return;
    }
    this.running = true;
    this.pollSub = timer(0, POLL_MS).subscribe(() => this.poll());
    document.addEventListener('visibilitychange', this.onVisibilityChange);
  }

  stop(): void {
    this.running = false;
    this.pollSub?.unsubscribe();
    this.pollSub = undefined;
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
  }

  reset(): void {
    this.stop();
    this.liveTrack.set(null);
    this.pinnedTrack.set(null);
    this.isPlaying.set(false);
    this.progressMs.set(0);
  }

  pin(track: InspectorTrack): void {
    this.pinnedTrack.set(track);
  }

  unpin(): void {
    this.pinnedTrack.set(null);
  }

  private poll(): void {
    if (document.visibilityState === 'hidden') {
      return;
    }

    this.api.getNowPlaying().subscribe({
      next: (response) => this.apply(response),
      // Fehlende Berechtigung/Netzfehler: letzten bekannten Stand behalten.
      error: () => undefined,
    });
  }

  private apply(response: NowPlayingResponseDto): void {
    this.isPlaying.set(Boolean(response.is_playing));
    this.progressMs.set(response.progress_ms ?? 0);
    this.liveTrack.set(response.track ? this.toInspectorTrack(response.track) : null);
  }

  private toInspectorTrack(track: NowPlayingTrackDto): InspectorTrack {
    return {
      id: track.id,
      name: track.name,
      artists: (track.artists ?? []).map((artist) => artist.name).join(', '),
      albumName: track.album_name,
      imageUrl: track.image_url,
      durationMs: track.duration_ms,
      spotifyUrl: track.spotify_url,
    };
  }
}
