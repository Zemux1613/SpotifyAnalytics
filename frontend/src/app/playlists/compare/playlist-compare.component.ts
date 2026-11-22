import { DecimalPipe } from '@angular/common';
import { AfterViewInit, Component, computed, ElementRef, HostListener, input, output, viewChild } from '@angular/core';
import { PlaylistOverviewItemDto } from '../../api/generated';
import { RadarChartComponent, RadarSeries } from '../../shared/components/radar-chart/radar-chart.component';

interface GenreRow {
  name: string;
  shareA: number;
  shareB: number;
}

/** Overlay, das zwei Playlists über Radar und Genre-Verteilung direkt vergleicht. */
@Component({
  selector: 'app-playlist-compare',
  imports: [DecimalPipe, RadarChartComponent],
  templateUrl: './playlist-compare.component.html',
  styleUrl: './playlist-compare.component.scss',
})
export class PlaylistCompareComponent implements AfterViewInit {
  private readonly dialog = viewChild.required<ElementRef<HTMLElement>>('dialog');

  readonly a = input.required<PlaylistOverviewItemDto>();
  readonly b = input.required<PlaylistOverviewItemDto>();
  readonly closed = output<void>();

  protected readonly radarSeries = computed<RadarSeries[]>(() => {
    const series: RadarSeries[] = [];
    if (this.a().avg_radar) series.push({ label: this.a().name, values: this.a().avg_radar!, tone: 'a' });
    if (this.b().avg_radar) series.push({ label: this.b().name, values: this.b().avg_radar!, tone: 'b' });
    return series;
  });

  protected readonly missingRadar = computed(() =>
    [this.a(), this.b()].filter((pl) => !pl.avg_radar).map((pl) => pl.name),
  );

  /** Vereinigung der Genres beider Playlists, stärkste zuerst. */
  protected readonly genreRows = computed<GenreRow[]>(() => {
    const rows = new Map<string, GenreRow>();
    for (const g of this.a().genres ?? []) {
      rows.set(g.name, { name: g.name, shareA: g.share, shareB: 0 });
    }
    for (const g of this.b().genres ?? []) {
      const row = rows.get(g.name);
      if (row) row.shareB = g.share;
      else rows.set(g.name, { name: g.name, shareA: 0, shareB: g.share });
    }
    return [...rows.values()].sort((x, y) => Math.max(y.shareA, y.shareB) - Math.max(x.shareA, x.shareB));
  });

  /** Histogramm-Überlappung der Genre-Anteile (0 = nichts gemeinsam, 100 = identisch). */
  protected readonly overlapPercent = computed(() => {
    const rows = this.genreRows();
    if (rows.length === 0 || !this.a().genres?.length || !this.b().genres?.length) return null;
    return Math.round(rows.reduce((sum, row) => sum + Math.min(row.shareA, row.shareB), 0) * 100);
  });

  ngAfterViewInit(): void {
    this.dialog().nativeElement.focus();
  }

  @HostListener('document:keydown.escape')
  protected onEscape(): void {
    this.closed.emit();
  }

  protected duration(ms?: number | null): string {
    if (!ms || ms <= 0) return '–';
    const totalMinutes = Math.round(ms / 60_000);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return hours > 0 ? `${hours} Std. ${minutes} Min.` : `${minutes} Min.`;
  }
}
