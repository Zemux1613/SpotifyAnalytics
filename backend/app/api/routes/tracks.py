from typing import Any

from fastapi import APIRouter, Query

from app.api.deps import (
    AccessTokenDep,
    PlaylistServiceDep,
    RecommenderServiceDep,
    SessionIdDep,
    TrackServiceDep,
)

router = APIRouter(prefix="/tracks", tags=["tracks"])


# wichtig: /search muss vor /{track_id} stehen, sonst wird "search" als track_id gelesen
@router.get("/search")
def search_tracks(
    tracks: TrackServiceDep,
    token: AccessTokenDep,
    q: str = Query(..., min_length=1, max_length=100),
    limit: int = Query(10, ge=1, le=10),  # spotify erlaubt in dev-mode max. 10
) -> dict[str, Any]:
    return tracks.search(token, q.strip(), limit)


@router.get("/{track_id}/playlist-suggestions")
def playlist_suggestions(
    track_id: str,
    tracks: TrackServiceDep,
    recommender: RecommenderServiceDep,
    token: AccessTokenDep,
    session_id: SessionIdDep,
    refresh: bool = Query(False),
) -> dict[str, Any]:
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


@router.get("/{track_id}")
def get_track(track_id: str, tracks: TrackServiceDep, token: AccessTokenDep) -> dict[str, Any]:
    return tracks.get_details(token, track_id)
