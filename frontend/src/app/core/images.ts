import { SpotifyImage } from '@shared/interfaces/Spotify';

/** Wählt das kleinste Bild, das mindestens `minWidth` breit ist (sonst das größte). */
export function pickImage(images: SpotifyImage[] | undefined, minWidth: number): string | undefined {
  if (!images?.length) {
    return undefined;
  }
  const width = (image: SpotifyImage) => image.width ?? Number.MAX_SAFE_INTEGER;
  const sorted = [...images].sort((a, b) => width(a) - width(b));
  return (sorted.find((image) => width(image) >= minWidth) ?? sorted[sorted.length - 1]).url;
}
