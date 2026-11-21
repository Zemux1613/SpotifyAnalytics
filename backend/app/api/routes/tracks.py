from fastapi import APIRouter, Query

from app.api.schemas import (
    API_ERROR_RESPONSES,
    PlaylistSuggestionsResponse,
    TrackDetailsResponse,
    TrackSearchResponse,
)
from app.api.deps import (
    AccessTokenDep,
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
