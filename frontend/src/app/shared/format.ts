import { SpotifyAlbumDtoReleaseDatePrecisionEnum } from '../api/generated';

export function formatDuration(ms: number | null | undefined): string {
  if (ms == null) {
    return '';
  }
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

const MONTHS = [
  'Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
  'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember',
];

/** Spotify liefert je nach Genauigkeit "2013", "2013-05" oder "2013-05-17". */
export function formatReleaseDate(date: string, precision: SpotifyAlbumDtoReleaseDatePrecisionEnum): string {
  const [year, month, day] = date.split('-');
  const monthName = MONTHS[Number(month) - 1];
  if (precision === 'day' && monthName && day) {
    return `${Number(day)}. ${monthName} ${year}`;
  }
  if (precision === 'month' && monthName) {
    return `${monthName} ${year}`;
  }
  return year;
}
