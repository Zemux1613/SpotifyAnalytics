import { Component, computed, input } from '@angular/core';
import { AudioRadarValuesDto } from '../../../api/generated';

export interface RadarSeries {
  label: string;
  values: AudioRadarValuesDto;
  /** a = Akzentfarbe, b = zweite Farbe für Vergleiche */
  tone: 'a' | 'b';
}

const CENTER = 120;
const AXES = ['tempo', 'brightness', 'rhythm', 'texture'] as const;

/** Radar über die vier Audio-Merkmale; mehrere Serien werden übereinandergelegt. */
@Component({
  selector: 'app-radar-chart',
  templateUrl: './radar-chart.component.html',
  styleUrl: './radar-chart.component.scss',
})
export class RadarChartComponent {
  readonly series = input.required<RadarSeries[]>();

  protected readonly polygons = computed(() =>
    this.series().map((entry) => ({
      label: entry.label,
      tone: entry.tone,
      points: AXES.map((axis, index) => {
        const angle = ((-90 + index * 90) * Math.PI) / 180;
        const radius = entry.values[axis] * 0.75;
        return `${CENTER + Math.cos(angle) * radius},${CENTER + Math.sin(angle) * radius}`;
      }).join(' '),
    })),
  );

  protected readonly ariaLabel = computed(() => {
    const parts = this.series().map(
      (s) =>
        `${s.label}: Tempo ${Math.round(s.values.tempo)}, Helligkeit ${Math.round(s.values.brightness)}, ` +
        `Rhythmus ${Math.round(s.values.rhythm)}, Textur ${Math.round(s.values.texture)}`,
    );
    return `Radar-Chart der Audio-Merkmale. ${parts.join('; ')}`;
  });
}
