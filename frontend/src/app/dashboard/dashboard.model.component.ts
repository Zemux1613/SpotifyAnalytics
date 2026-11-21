export interface GenreStat {
  name: string;
  count: number;
}

export interface DashboardStats {
  streams: number;
  minutes: number;
  songs: number;
  artists: number;
  genres: GenreStat[];
}

export interface Metric {
  label: string;
  value: string;
  change: number | null;
}
