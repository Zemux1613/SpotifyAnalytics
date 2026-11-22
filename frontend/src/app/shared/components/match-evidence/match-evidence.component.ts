import { Component, computed, input } from '@angular/core';
import { PlaylistSuggestionDto, PlaylistSuggestionDtoMethodEnum } from '../../../api/generated';

export type ConfidenceTier = 'high' | 'mid' | 'low';

export const TIER_LABELS: Record<ConfidenceTier, string> = {
  high: 'Starker Treffer',
  mid: 'Möglicher Treffer',
  low: 'Eher unsicher',
};

export function confidenceTier(percent: number): ConfidenceTier {
  if (percent >= 70) return 'high';
  if (percent >= 40) return 'mid';
  return 'low';
}

/** Konfidenz-Balken plus „Warum?“-Pills für einen Playlist-Vorschlag. */
@Component({
  selector: 'app-match-evidence',
  templateUrl: './match-evidence.component.html',
  styleUrl: './match-evidence.component.scss',
})
export class MatchEvidenceComponent {
  readonly suggestion = input.required<PlaylistSuggestionDto>();
  readonly large = input(false);

  protected readonly tier = computed(() => confidenceTier(this.suggestion().match_percent));
  protected readonly tierLabel = computed(() => TIER_LABELS[this.tier()]);
  protected readonly isEstimate = computed(
    () => this.suggestion().method === PlaylistSuggestionDtoMethodEnum.GenreFallback,
  );
  protected readonly reasons = computed(() => this.suggestion().reasons ?? []);
}
