import { JsonPipe } from '@angular/common';
import { Component, computed, input } from '@angular/core';
import { pickImage } from '../../core/images';
import { SpotifyArtistDto, TrackDetailsResponseDto } from '../../api/generated';
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
  imports: [JsonPipe],
  templateUrl: './track-details.component.html',
})
export class TrackDetailsComponent {
  readonly data = input.required<TrackDetailsResponseDto>();

  protected readonly track = computed(() => this.data().track);
  protected readonly cover = computed(() => pickImage(this.track().album.images, 440));
  protected readonly artistNames = computed(() =>
    this.track()
      .artists.map((a) => a.name)
      .join(', '),
  );

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

  protected avatar(artist: SpotifyArtistDto): string | undefined {
    return pickImage(artist.images, 112);
  }

  protected genres(artist: SpotifyArtistDto): string {
    return (artist.genres ?? []).join(', ');
  }
}
