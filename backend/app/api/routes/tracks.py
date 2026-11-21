from fastapi import APIRouter, BackgroundTasks, Query

from app.api.schemas import (
    API_ERROR_RESPONSES,
    AudioAnalysisResponse,
    PlaylistSuggestionsResponse,
    TrackDetailsResponse,
    TrackSearchResponse,
)
from app.api.deps import (
    AccessTokenDep,
    AudioAnalysisServiceDep,
    RecommenderServiceDep,
    SessionIdDep,
    TrackServiceDep,
)

router = APIRouter(prefix="/tracks", tags=["tracks"])


# wichtig: /search muss vor /{track_id} stehen, sonst wird "search" als track_id gelesen
@router.get(
    "/search",
    response_model=TrackSearchResponse,
    responses=API_ERROR_RESPONSES,
)
def search_tracks(
    tracks: TrackServiceDep,
    token: AccessTokenDep,
    q: str = Query(..., min_length=1, max_length=100),
    limit: int = Query(10, ge=1, le=10),  # spotify erlaubt in dev-mode max. 10
) -> TrackSearchResponse:
    return tracks.search(token, q.strip(), limit)


@router.get(
    "/{track_id}/playlist-suggestions",
    response_model=PlaylistSuggestionsResponse,
    responses=API_ERROR_RESPONSES,
)
def playlist_suggestions(
    track_id: str,
    tracks: TrackServiceDep,
    recommender: RecommenderServiceDep,
    token: AccessTokenDep,
    session_id: SessionIdDep,
    refresh: bool = Query(False),
) -> PlaylistSuggestionsResponse:
    """Zu welchen Playlists des Users passt der Track – inkl. Prozentwert.

    Das Modell wird beim ersten Aufruf trainiert und danach gecacht.
    Mit refresh=true wird es neu aufgebaut.
    """
    details = tracks.get_details(token, track_id)
    return recommender.get_suggestions(
        token,
        session_id,
        details["track"],
        details["artists"],
        refresh=refresh,
    )


@router.get(
    "/{track_id}",
    response_model=TrackDetailsResponse,
    responses=API_ERROR_RESPONSES,
)
def get_track(
    track_id: str, tracks: TrackServiceDep, token: AccessTokenDep
) -> TrackDetailsResponse:
    return tracks.get_details(token, track_id)


@router.post(
    "/{track_id}/audio-analysis",
    response_model=AudioAnalysisResponse,
    status_code=202,
    responses=API_ERROR_RESPONSES,
    operation_id="start_track_audio_analysis",
)
def start_track_audio_analysis(
    track_id: str,
    background_tasks: BackgroundTasks,
    tracks: TrackServiceDep,
    analysis: AudioAnalysisServiceDep,
    token: AccessTokenDep,
) -> AudioAnalysisResponse:
    """Startet die Audio-Analyse eines Spotify-Preview-Snippets."""
    details = tracks.get_details(token, track_id)
    preview_url = analysis.resolve_preview_url(details["track"])
    return analysis.enqueue(track_id, preview_url, background_tasks)


@router.get(
    "/{track_id}/audio-analysis",
    response_model=AudioAnalysisResponse,
    responses=API_ERROR_RESPONSES,
    operation_id="get_track_audio_analysis",
)
def get_track_audio_analysis(
    track_id: str, analysis: AudioAnalysisServiceDep, token: AccessTokenDep
) -> AudioAnalysisResponse:
    """Liefert den aktuellen Status oder das Ergebnis der Audio-Analyse."""
    return analysis.get_status(track_id)