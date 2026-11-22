from typing import Any
from fastapi import APIRouter, Depends, Query
from app.services.playlist_service import PlaylistService

from app.api.schemas import (
    API_ERROR_RESPONSES,
    AddTrackRequest,
    AddTrackResponse,
    ModelStatusResponse,
    PlaylistDetailResponse,
    PlaylistSummary,
    PlaylistsOverviewResponse,
    UnsortedTracksResponse,
)
from app.api.deps import (
    AccessTokenDep,
    AudioAnalysisServiceDep,
    PlaylistServiceDep,
    RecommenderServiceDep,
    SessionIdDep
)

router = APIRouter(prefix="/playlists", tags=["playlists"])


@router.get(
    "",
    response_model=list[PlaylistSummary],
    responses=API_ERROR_RESPONSES,
)
def list_playlists(
    playlists: PlaylistServiceDep,
    token: AccessTokenDep,
) -> list[PlaylistSummary]:
    """Die Playlists des Users (Basis für das Empfehlungsmodell)."""
    items = playlists.list_playlists(token)
    return [
        {
            "id": item.get("id"),
            "name": item.get("name"),
            "owner": (item.get("owner") or {}).get("display_name")
            or (item.get("owner") or {}).get("id"),
            "track_count": (item.get("tracks") or {}).get("total") or 0,
            "image_url": _pick_image(item.get("images")),
            "spotify_url": (item.get("external_urls") or {}).get("spotify"),
            "collaborative": bool(item.get("collaborative")),
            "public": item.get("public"),
        }
        for item in items
        if item.get("id")
    ]


@router.get(
    "/model",
    response_model=ModelStatusResponse,
    responses=API_ERROR_RESPONSES,
    operation_id="get_playlist_model_status",
)
def get_model_status(
    recommender: RecommenderServiceDep,
    token: AccessTokenDep,
    session_id: SessionIdDep,
) -> ModelStatusResponse:
    """Status des Playlist-Modells (trainiert/gecacht), ohne es zu trainieren."""
    return recommender.get_model_status(token, session_id)


@router.post(
    "/model",
    response_model=ModelStatusResponse,
    responses=API_ERROR_RESPONSES,
    operation_id="train_playlist_model",
)
def train_model(
    recommender: RecommenderServiceDep,
    token: AccessTokenDep,
    session_id: SessionIdDep,
) -> ModelStatusResponse:
    """Trainiert das Playlist-Modell neu und liefert den neuen Status."""
    return recommender.train_model(token, session_id)


@router.post(
    "/{playlist_id}/tracks",
    response_model=AddTrackResponse,
    responses=API_ERROR_RESPONSES,
)
def add_track_to_playlist(
    playlist_id: str,
    body: AddTrackRequest,
    recommender: RecommenderServiceDep,
    token: AccessTokenDep,
    session_id: SessionIdDep,
) -> AddTrackResponse:
    """One-Click-Add: fügt den Track zur Playlist hinzu (POST /playlists/{id}/tracks)."""
    return recommender.add_track(token, session_id, playlist_id, body.track_uri)


def _pick_image(images: list[dict[str, Any]] | None, target: int = 64) -> str | None:
    if not images:
        return None
    with_url = [image for image in images if image.get("url")]
    if not with_url:
        return None
    return min(with_url, key=lambda image: abs(int(image.get("width") or 0) - target))["url"]

@router.get(
    "/overview",
    response_model=PlaylistsOverviewResponse,
    responses=API_ERROR_RESPONSES,
    operation_id="get_playlists_overview",
)
def get_playlists_overview(
    playlists: PlaylistServiceDep,
    recommender: RecommenderServiceDep,
    audio: AudioAnalysisServiceDep,
    token: AccessTokenDep,
    session_id: SessionIdDep,
    include_followed: bool = Query(default=False, description="Auch abonnierte fremde Playlists anzeigen"),
) -> PlaylistsOverviewResponse:
    user_id, genres_by_playlist, metrics_by_playlist, model_trained = (
        recommender.get_playlist_genre_overview(token, session_id)
    )
    for m in metrics_by_playlist.values():
        avg_bpm, dominant_mood = audio.playlist_vibe(m.get("track_ids") or [])
        m["avg_bpm"] = avg_bpm
        m["dominant_mood"] = dominant_mood
        m["avg_radar"] = audio.playlist_radar(m.get("track_ids") or [])

    return playlists.get_playlists_overview(
        access_token=token,
        user_id=user_id,
        genres_by_playlist=genres_by_playlist,
        metrics_by_playlist=metrics_by_playlist,
        model_trained=model_trained,
        include_followed=include_followed,
    )


@router.get(
    "/unsorted-tracks",
    response_model=UnsortedTracksResponse,
    responses=API_ERROR_RESPONSES,
    operation_id="get_unsorted_tracks",
)
def get_unsorted_tracks(
    recommender: RecommenderServiceDep,
    token: AccessTokenDep,
    session_id: SessionIdDep,
    limit: int = Query(default=50, ge=1, le=200, description="Maximale Anzahl Songs in der Triage-Queue"),
) -> UnsortedTracksResponse:
    """Lieblingssongs, die noch in keiner deiner Playlists liegen (Queue für den Triage-Modus)."""
    return recommender.get_unsorted_tracks(token, session_id, limit)


@router.get(
    "/{playlist_id}",
    response_model=PlaylistDetailResponse,
    responses=API_ERROR_RESPONSES,
    operation_id="get_playlist_detail",
)
def get_playlist_detail(
    playlist_id: str,
    playlists: PlaylistServiceDep,
    token: AccessTokenDep,
) -> PlaylistDetailResponse:
    """Playlist-Details inkl. aller Songs für die Detailansicht."""
    return playlists.get_playlist_detail(token, playlist_id)