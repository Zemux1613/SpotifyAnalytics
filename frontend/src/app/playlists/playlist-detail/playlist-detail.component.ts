import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { PlaylistDetailResponseDto, PlaylistTrackItemDto } from '../../api/generated';
import { PlaylistsApi } from '../../api/generated/api/playlists.service';
import { DurationPipe } from '../../shared/duration.pipe';
import { errorMessage } from '../../core/http-error';

@Component({
  selector: 'app-playlist-detail',
  standalone: true,
  imports: [CommonModule, RouterLink, DurationPipe],
  templateUrl: './playlist-detail.component.html',
  styleUrl: './playlist-detail.component.scss',
})
export class PlaylistDetailComponent implements OnInit {
  private readonly playlistsApi = inject(PlaylistsApi);
  private readonly route = inject(ActivatedRoute);

  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly playlist = signal<PlaylistDetailResponseDto | null>(null);

  readonly tracks = computed(() => this.playlist()?.tracks ?? []);
  readonly totalDurationMs = computed(() =>
    this.tracks().reduce((sum, track) => sum + (track.duration_ms ?? 0), 0),
  );

  ngOnInit(): void {
    this.route.paramMap.subscribe((params) => {
      const playlistId = params.get('id');
      if (playlistId) {
        this.load(playlistId);
      }
    });
  }

  load(playlistId: string): void {
    this.loading.set(true);
    this.error.set(null);

    this.playlistsApi.getPlaylistDetail({ playlistId }).subscribe({
      next: (response) => {
        this.playlist.set(response);
        this.loading.set(false);
      },
      error: (err: unknown) => {
        this.error.set(errorMessage(err));
        this.loading.set(false);
      },
    });
  }

  retry(): void {
    const playlistId = this.route.snapshot.paramMap.get('id');
    if (playlistId) {
      this.load(playlistId);
    }
  }

  artistNames(track: PlaylistTrackItemDto): string {
    return (track.artists ?? []).map((artist) => artist.name).join(', ');
  }

  formatTotalDuration(ms: number): string {
    if (!ms || ms <= 0) return '';
    const totalMinutes = Math.round(ms / 60_000);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return hours > 0 ? `${hours} Std. ${minutes} Min.` : `${minutes} Min.`;
  }
}
