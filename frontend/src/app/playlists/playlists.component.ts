import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { PlaylistOverviewItemDto } from '../api/generated';
import { PlaylistsApi } from '../api/generated/api/playlists.service'
import { PlaylistCompareComponent } from './compare/playlist-compare.component';
import { TriageComponent } from './triage/triage.component';

export type PlaylistSortOption = 'default' | 'tracks_desc' | 'name_asc' | 'trained_first';

@Component({
  selector: 'app-playlists',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, TriageComponent, PlaylistCompareComponent],
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

  // Triage-Fokusmodus und Playlist-Vergleich
  readonly triageOpen = signal(false);
  readonly compareOpen = signal(false);
  /** IDs der für den Vergleich markierten Playlists (maximal zwei, älteste Auswahl zuerst) */
  readonly selectedIds = signal<string[]>([]);

  readonly selectedItems = computed(() => {
    const byId = new Map(this.items().map((pl) => [pl.id, pl]));
    return this.selectedIds()
      .map((id) => byId.get(id))
      .filter((pl): pl is PlaylistOverviewItemDto => !!pl);
  });
  readonly compareReady = computed(() => this.selectedItems().length === 2);

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
      .getPlaylistsOverview({ includeFollowed: this.includeFollowed() })
      .subscribe({
        next: (res) => {
          this.items.set(res.items ?? []);
          // Auswahl auf Playlists begrenzen, die es in der aktuellen Ansicht noch gibt
          const known = new Set((res.items ?? []).map((pl) => pl.id));
          this.selectedIds.update((ids) => ids.filter((id) => known.has(id)));
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

  openTriage(): void {
    this.triageOpen.set(true);
  }

  closeTriage(sortedCount: number): void {
    this.triageOpen.set(false);
    if (sortedCount > 0) {
      this.load(); // Songanzahlen der Playlists haben sich geändert
    }
  }

  isSelected(id: string): boolean {
    return this.selectedIds().includes(id);
  }

  /** Bei zwei Markierungen sind weitere Checkboxen gesperrt, bis eine abgewählt wird. */
  selectionLocked(id: string): boolean {
    return this.selectedIds().length >= 2 && !this.isSelected(id);
  }

  toggleSelected(id: string): void {
    this.selectedIds.update((ids) => {
      if (ids.includes(id)) return ids.filter((x) => x !== id);
      return ids.length >= 2 ? ids : [...ids, id];
    });
  }

  clearSelection(): void {
    this.selectedIds.set([]);
    this.compareOpen.set(false);
  }

  openCompare(): void {
    if (this.compareReady()) this.compareOpen.set(true);
  }

  formatDuration(ms?: number | null): string | null {
    if (!ms || ms <= 0) return null;
    const totalMinutes = Math.round(ms / 60_000);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return hours > 0 ? `${hours} Std. ${minutes} Min.` : `${minutes} Min.`;
  }
}