import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { PlaylistOverviewItemDto } from '../api/generated';
import { PlaylistsApi } from '../api/generated/api/playlists.service'

export type PlaylistSortOption = 'default' | 'tracks_desc' | 'name_asc' | 'trained_first';

@Component({
  selector: 'app-playlists',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './playlists.component.html',
  styleUrl: './playlists.component.scss',
})
export class PlaylistsComponent implements OnInit {
  private readonly playlistsApi = inject(PlaylistsApi);

  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly includeFollowed = signal(false);
  readonly searchQuery = signal('');
  readonly sortBy = signal<PlaylistSortOption>('default');
  readonly items = signal<PlaylistOverviewItemDto[]>([]);
  readonly modelTrained = signal(false);

  readonly filteredItems = computed(() => {
    const q = this.searchQuery().trim().toLowerCase();
    const sort = this.sortBy();

    const filtered = this.items().filter((pl) => {
      if (!q) return true;
      const inName = pl.name.toLowerCase().includes(q);
      const inGenres = (pl.genres ?? []).some((g) => g.name.toLowerCase().includes(q));
      return inName || inGenres;
    });

    if (sort === 'default') {
      return filtered;
    }

    return [...filtered].sort((a, b) => {
      switch (sort) {
        case 'tracks_desc':
          return (b.tracks_total ?? 0) - (a.tracks_total ?? 0);
        case 'name_asc':
          return a.name.localeCompare(b.name, 'de', { sensitivity: 'base' });
        case 'trained_first': {
          const trainedDiff = Number(Boolean(b.in_model)) - Number(Boolean(a.in_model));
          return trainedDiff !== 0 ? trainedDiff : (b.tracks_total ?? 0) - (a.tracks_total ?? 0);
        }
        default:
          return 0;
      }
    });
  });

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.error.set(null);
    this.playlistsApi
      .getPlaylistsOverviewPlaylistsOverviewGet({ includeFollowed: this.includeFollowed() })
      .subscribe({
        next: (res) => {
          this.items.set(res.items ?? []);
          this.modelTrained.set(Boolean(res.model_trained));
          this.loading.set(false);
        },
        error: (err) => {
          this.error.set(err?.error?.detail ?? 'Playlists konnten nicht geladen werden.');
          this.loading.set(false);
        },
      });
  }

  toggleFollowed(value: boolean): void {
    if (this.includeFollowed() === value) return;
    this.includeFollowed.set(value);
    this.load();
  }

  filterByGenre(genre: string): void {
    // Erneuter Klick auf dasselbe Genre hebt den Filter wieder auf
    if (this.searchQuery().trim().toLowerCase() === genre.toLowerCase()) {
      this.searchQuery.set('');
    } else {
      this.searchQuery.set(genre);
    }
  }

  clearSearch(): void {
    this.searchQuery.set('');
  }
}