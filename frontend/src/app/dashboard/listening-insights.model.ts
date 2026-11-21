export interface ListeningHeatmapCell {
  weekday: number;
  hour: number;
  count: number;
}

export interface DiscoveryStats {
  tracks_rate: number | null;
  tracks_count: number;
  tracks_discovered: number;
  tracks_previous_rate: number | null;
  tracks_change_pp: number | null;
  artists_rate: number | null;
  artists_count: number;
  artists_discovered: number;
  artists_previous_rate: number | null;
  artists_change_pp: number | null;
}

export interface ListeningStreak {
  current_days: number;
  longest_days: number;
  tracked_since: string | null;
}

export interface ListeningDay {
  date: string; // YYYY-MM-DD in der Zeitzone des Users
  minutes: number;
  plays: number;
}

export interface ListeningInsights {
  time_range: string;
  timezone: string;
  sample_size: number;
  fetched_items: number;
  oldest_played_at: string | null;
  heatmap: ListeningHeatmapCell[];
  discovery: DiscoveryStats;
  streak: ListeningStreak;
  daily: ListeningDay[]; // letzte 14 Tage, älteste zuerst
}
