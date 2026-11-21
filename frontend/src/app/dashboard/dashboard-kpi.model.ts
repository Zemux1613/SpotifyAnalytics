import { ModelInfoDto } from '../api/generated';

export type AudioSummaryStatus =
  | 'not_started'
  | 'queued'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'unavailable';

export interface AudioSummaryTrack {
  track_id: string;
  status: AudioSummaryStatus;
  tempo_bpm: number | null;
}

export interface AudioAnalysisSummary {
  tracks: AudioSummaryTrack[];
}

export interface ModelStatus {
  trained: boolean;
  model: ModelInfoDto | null;
  expires_in_seconds: number | null;
}
