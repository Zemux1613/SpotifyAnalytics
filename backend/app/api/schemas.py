"""Pydantic-Modelle bilden den öffentlichen HTTP-API-Vertrag.

Die Spotify-Antworten werden bewusst auf die Felder reduziert, die unsere API
an das Frontend weitergibt. Dadurch bleiben OpenAPI und die generierten
Angular-DTOs unabhängig von Änderungen an nicht verwendeten Spotify-Feldern.
"""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.domain import TimeRange


class ApiModel(BaseModel):
    """Gemeinsame Konfiguration für serialisierbare API-Modelle."""

    model_config = ConfigDict(extra="ignore")


class ErrorResponse(ApiModel):
    detail: str


class HealthResponse(ApiModel):
    status: Literal["ok"]


class LogoutResponse(ApiModel):
    status: Literal["ausgeloggt"]


class ExternalUrls(ApiModel):
    spotify: str | None = None


class SpotifyExternalIds(ApiModel):
    isrc: str | None = None


class SpotifyImage(ApiModel):
    url: str
    width: int | None = None
    height: int | None = None


class ArtistRef(ApiModel):
    id: str
    name: str
    uri: str
    external_urls: ExternalUrls | None = None


class SpotifyArtist(ArtistRef):
    genres: list[str] = Field(default_factory=list)
    images: list[SpotifyImage] = Field(default_factory=list)


class SpotifyAlbum(ApiModel):
    id: str
    name: str
    album_type: str
    total_tracks: int
    release_date: str
    release_date_precision: Literal["year", "month", "day"]
    images: list[SpotifyImage] = Field(default_factory=list)
    artists: list[ArtistRef] = Field(default_factory=list)
    external_urls: ExternalUrls | None = None


class SpotifyTrack(ApiModel):
    id: str
    name: str
    uri: str
    duration_ms: int
    popularity: int
    preview_url: str | None = None
    explicit: bool
    track_number: int
    disc_number: int
    is_playable: bool | None = None
    artists: list[ArtistRef] = Field(default_factory=list)
    album: SpotifyAlbum
    external_ids: SpotifyExternalIds | None = None
    external_urls: ExternalUrls | None = None


class Paging(ApiModel):
    total: int
    limit: int
    offset: int
    next: str | None = None
    previous: str | None = None


class TrackPaging(Paging):
    items: list[SpotifyTrack]


class ArtistPaging(Paging):
    items: list[SpotifyArtist]


class TrackSearchResponse(ApiModel):
    tracks: TrackPaging


class TrackDetailsResponse(ApiModel):
    track: SpotifyTrack
    artists: list[SpotifyArtist]


class AudioRadarValues(ApiModel):
    tempo: float = Field(ge=0, le=100)
    brightness: float = Field(ge=0, le=100)
    rhythm: float = Field(ge=0, le=100)
    texture: float = Field(ge=0, le=100)


class AudioFeatures(ApiModel):
    tempo_bpm: float = Field(ge=0)
    spectral_centroid_hz: float = Field(ge=0)
    zero_crossing_rate: float = Field(ge=0, le=1)
    mfcc: list[float]
    radar: AudioRadarValues
    mood: Literal["Workout", "Deep Focus", "Melancholisch"]
    clustering_method: Literal["heuristic", "kmeans"]


class AudioAnalysisResponse(ApiModel):
    track_id: str
    status: Literal["queued", "processing", "completed", "failed", "unavailable"]
    features: AudioFeatures | None = None
    message: str | None = None


class AudioSummaryTrack(ApiModel):
    track_id: str
    status: Literal[
        "not_started", "queued", "processing", "completed", "failed", "unavailable"
    ]
    tempo_bpm: float | None = None


class AudioAnalysisSummary(ApiModel):
    tracks: list[AudioSummaryTrack]


class UserProfile(ApiModel):
    id: str
    display_name: str | None = None
    images: list[SpotifyImage] = Field(default_factory=list)


class PlaylistSummary(ApiModel):
    id: str
    name: str
    owner: str | None = None
    track_count: int
    image_url: str | None = None
    spotify_url: str | None = None
    collaborative: bool = False
    public: bool | None = None


class PlaylistSuggestion(ApiModel):
    playlist_id: str
    name: str
    image_url: str | None = None
    spotify_url: str | None = None
    track_count: int
    match_percent: int = Field(ge=0, le=100)
    method: Literal["random_forest", "genre_fallback"]
    already_in_playlist: bool
    top_genres: list[str] = Field(default_factory=list)


class ModelInfo(ApiModel):
    playlists_used: int
    playlists_trained: int
    playlists_total: int
    tracks_used: int
    genres: int
    trained_at: datetime
    cached: bool


class ModelStatusResponse(ApiModel):
    trained: bool
    model: ModelInfo | None = None
    expires_in_seconds: int | None = None


class PlaylistSuggestionsResponse(ApiModel):
    track_id: str
    suggestions: list[PlaylistSuggestion]
    model: ModelInfo
    message: str | None = None


class AddTrackRequest(ApiModel):
    track_uri: str = Field(min_length=1, max_length=200)


class AddTrackResponse(ApiModel):
    status: Literal["hinzugefügt"]
    snapshot_id: str | None = None


API_ERROR_RESPONSES = {
    400: {"model": ErrorResponse, "description": "Ungültige Anfrage"},
    401: {"model": ErrorResponse, "description": "Nicht authentifiziert"},
    403: {"model": ErrorResponse, "description": "Fehlende Berechtigung"},
    502: {"model": ErrorResponse, "description": "Spotify nicht erreichbar"},
}


class ListeningHeatmapCell(ApiModel):
    weekday: int = Field(ge=0, le=6)
    hour: int = Field(ge=0, le=23)
    count: int = Field(ge=0)


class DiscoveryStats(ApiModel):
    tracks_rate: float | None = None
    tracks_count: int
    tracks_discovered: int
    tracks_previous_rate: float | None = None
    tracks_change_pp: float | None = None
    artists_rate: float | None = None
    artists_count: int
    artists_discovered: int
    artists_previous_rate: float | None = None
    artists_change_pp: float | None = None


class ListeningStreak(ApiModel):
    current_days: int
    longest_days: int
    tracked_since: str | None = None


class ListeningDay(ApiModel):
    date: str  # ISO-Datum (YYYY-MM-DD) in der Zeitzone des Users
    minutes: float = Field(ge=0)
    plays: int = Field(ge=0)


class ListeningInsightsResponse(ApiModel):
    time_range: TimeRange
    timezone: str
    sample_size: int
    fetched_items: int
    oldest_played_at: datetime | None = None
    heatmap: list[ListeningHeatmapCell]
    discovery: DiscoveryStats
    streak: ListeningStreak
    daily: list[ListeningDay] = Field(default_factory=list)  # letzte 14 Tage, älteste zuerst

class PlaylistGenreItem(BaseModel):
    name: str
    count: int
    share: float  # 0.0 bis 1.0 (für Balkenbreite & Prozentanzeige)

class PlaylistOverviewItem(BaseModel):
    id: str
    name: str
    image_url: str | None = None
    spotify_url: str | None = None
    tracks_total: int
    owner_name: str
    is_owned: bool
    in_model: bool
    genres: list[PlaylistGenreItem] = []
    duration_ms: int | None = None
    avg_release_year: int | None = None
    avg_bpm: float | None = None
    dominant_mood: str | None = None

class PlaylistsOverviewResponse(BaseModel):
    items: list[PlaylistOverviewItem]
    model_trained: bool


class PlaylistTrackItem(ApiModel):
    id: str
    name: str
    uri: str
    duration_ms: int
    artists: list[ArtistRef] = Field(default_factory=list)
    album_name: str | None = None
    image_url: str | None = None
    spotify_url: str | None = None
    added_at: str | None = None


class PlaylistDetailResponse(ApiModel):
    id: str
    name: str
    description: str | None = None
    image_url: str | None = None
    spotify_url: str | None = None
    owner_name: str | None = None
    track_count: int
    tracks: list[PlaylistTrackItem] = Field(default_factory=list)