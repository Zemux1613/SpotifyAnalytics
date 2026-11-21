from typing import Any

from fastapi import APIRouter
from app.api.schemas import (
    API_ERROR_RESPONSES,
    AddTrackRequest,
    AddTrackResponse,
    PlaylistSummary,
)
from app.api.deps import (
    AccessTokenDep,
    PlaylistServiceDep,
    RecommenderServiceDep,
    SessionIdDep,
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
