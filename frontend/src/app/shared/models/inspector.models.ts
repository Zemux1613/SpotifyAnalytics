/** Kompakte Anzeigeform eines Tracks für Now-Playing-Leiste und Inspector. */
export interface InspectorTrack {
  id: string;
  name: string;
  artists?: string;
  albumName?: string | null;
  imageUrl?: string | null;
  durationMs?: number;
  spotifyUrl?: string | null;
}
