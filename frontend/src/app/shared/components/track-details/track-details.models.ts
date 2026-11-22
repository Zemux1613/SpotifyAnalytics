export const ALBUM_TYPES: Record<string, string> = {
  album: 'Album',
  single: 'Single',
  compilation: 'Compilation',
};

export interface Fact {
  label: string;
  value: string;
}