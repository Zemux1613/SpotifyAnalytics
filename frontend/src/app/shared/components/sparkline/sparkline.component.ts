import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';

const W = 100; // virtuelle Zeichenfläche; das SVG skaliert mit preserveAspectRatio="none"
const H = 32;
const PAD = 3;

/**
 * Mini-Chart ohne Achsen für KPI-Karten. Linie oder Balken, mit Hover-Tooltip.
 * Farben kommen aus den globalen Design-Tokens (siehe .spark in styles.scss).
 */
@Component({
  selector: 'app-sparkline',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './sparkline.component.html',
  styleUrl: './sparkline.component.scss'
})
export class SparklineComponent {
  readonly values = input.required<number[]>();
  readonly labels = input<string[]>([]);
  readonly type = input<'line' | 'bar'>('line');
  readonly ariaLabel = input<string>('Verlauf');
  /** false: Linie nutzt den Wertebereich statt der Nulllinie (z. B. BPM). */
  readonly zeroBased = input(true);
  readonly format = input<(value: number) => string>((value) => value.toLocaleString('de-DE'));

  protected readonly W = W;
  protected readonly H = H;
  protected readonly active = signal<number | null>(null);

  protected readonly focus = computed(() => this.active() ?? Math.max(0, this.values().length - 1));

  private readonly points = computed(() => {
    const values = this.values();
    if (values.length === 0) return [];
    const max = Math.max(...values);
    const min = this.zeroBased() ? Math.min(0, ...values) : Math.min(...values);
    const span = max - min;
    return values.map((value, i) => ({
      x: values.length === 1 ? W / 2 : (i / (values.length - 1)) * W,
      y: span === 0 ? H / 2 : H - PAD - ((value - min) / span) * (H - 2 * PAD),
    }));
  });

  protected readonly linePath = computed(() =>
    this.points()
      .map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(2)} ${p.y.toFixed(2)}`)
      .join(' '),
  );

  protected readonly areaPath = computed(() => {
    const points = this.points();
    if (points.length < 2) return '';
    const last = points[points.length - 1];
    return `${this.linePath()} L${last.x.toFixed(2)} ${H} L${points[0].x.toFixed(2)} ${H} Z`;
  });

  protected readonly bars = computed(() => {
    const values = this.values();
    const max = Math.max(0, ...values);
    const slot = W / Math.max(1, values.length);
    const gap = slot * 0.25;
    return values.map((value, i) => {
      const h = max === 0 ? 1.2 : Math.max(1.2, (value / max) * (H - PAD));
      return { x: i * slot + gap / 2, y: H - h, w: slot - gap, h };
    });
  });

  protected readonly dot = computed(() => {
    const point = this.points()[this.focus()];
    return point ? { x: (point.x / W) * 100, y: (point.y / H) * 100 } : null;
  });

  protected readonly tooltip = computed(() => {
    const i = this.active();
    const values = this.values();
    if (i === null || i >= values.length) return '';
    const label = this.labels()[i];
    return `${label ? label + ': ' : ''}${this.format()(values[i])}`;
  });

  protected readonly tipLeft = computed(() => {
    const i = this.active() ?? 0;
    const n = this.values().length;
    const raw =
      this.type() === 'bar' ? ((i + 0.5) / Math.max(1, n)) * 100 : (this.points()[i]?.x ?? 0);
    return Math.min(82, Math.max(18, raw)); // Tooltip nicht über den Kartenrand schieben
  });

  protected onMove(event: PointerEvent): void {
    const n = this.values().length;
    if (n === 0) return;
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    if (rect.width === 0) return;
    const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    this.active.set(
      this.type() === 'bar' ? Math.min(n - 1, Math.floor(ratio * n)) : Math.round(ratio * (n - 1)),
    );
  }
}
