import { computed, inject, Injectable, signal } from '@angular/core';
import { Subscription } from 'rxjs';
import {
  PlaylistTrackItemDto,
  SpotifyTrackDto,
  TrackDetailsResponseDto,
  TracksApi,
} from '../../api/generated';
import { errorMessage } from '../../core/http-error';
import { pickImage } from '../../core/images';
import { NowPlayingService } from '../../shared/services/now-playing.service';
import { InspectorTrack } from '../models/inspector.models';

/**
 * Zentraler Zustand für den Track-Inspector. Jede Seite kann einen Track
 * öffnen; der Drawer und die Now-Playing-Leiste hängen am App-Shell.
 */
@Injectable({ providedIn: 'root' })
export class InspectorService {
  private readonly tracksApi = inject(TracksApi);
  private readonly playback = inject(NowPlayingService);
  private readonly detailsCache = new Map<string, TrackDetailsResponseDto>();
  private detailsSub?: Subscription;

  readonly isOpen = signal(false);
  readonly current = signal<InspectorTrack | null>(null);
  readonly details = signal<TrackDetailsResponseDto | null>(null);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);

  readonly currentId = computed(() => this.current()?.id ?? null);

  showTrack(track: SpotifyTrackDto, open = true): void {
    this.show(
      {
        id: track.id,
        name: track.name,
        artists: (track.artists ?? []).map((artist) => artist.name).join(', '),
        albumName: track.album?.name,
        imageUrl: pickImage(track.album?.images, 96),
        durationMs: track.duration_ms,
        spotifyUrl: track.external_urls?.spotify,
      },
      open,
      true,
    );
  }

  showPlaylistTrack(track: PlaylistTrackItemDto, open = true): void {
    this.show(
      {
        id: track.id,
        name: track.name,
        artists: (track.artists ?? []).map((artist) => artist.name).join(', '),
        albumName: track.album_name,
        imageUrl: track.image_url,
        durationMs: track.duration_ms,
        spotifyUrl: track.spotify_url,
      },
      open,
      true,
    );
  }

  show(track: InspectorTrack, open = true, pin = false): void {
    const isSameTrack =
      this.current()?.id === track.id && this.details()?.track.id === track.id;

    if (pin) {
      this.playback.pin(track);
    }
    this.current.set(track);
    if (open) {
      this.isOpen.set(true);
    }
    if (isSameTrack) {
      return;
    }
    this.load(track.id);
  }

  open(): void {
    if (this.current()) {
      this.isOpen.set(true);
    }
  }

  close(): void {
    this.isOpen.set(false);
  }

  clear(): void {
    this.detailsSub?.unsubscribe();
    this.isOpen.set(false);
    this.current.set(null);
    this.details.set(null);
    this.loading.set(false);
    this.error.set(null);
  }

  private load(trackId: string): void {
    this.detailsSub?.unsubscribe();
    this.error.set(null);

    const cached = this.detailsCache.get(trackId);
    if (cached) {
      this.details.set(cached);
      this.loading.set(false);
      return;
    }

    this.details.set(null);
    this.loading.set(true);

    this.detailsSub = this.tracksApi
      .getTrackTracksTrackIdGet({ trackId })
      .subscribe({
        next: (response) => {
          this.detailsCache.set(trackId, response);
          // Beim schnellen Wechsel darf eine alte Antwort nichts überschreiben.
          if (this.current()?.id !== trackId) {
            return;
          }
          this.details.set(response);
          this.loading.set(false);
        },
        error: (err: unknown) => {
          if (this.current()?.id !== trackId) {
            return;
          }
          this.error.set(errorMessage(err));
          this.loading.set(false);
        },
      });
  }
}
