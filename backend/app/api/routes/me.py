from fastapi import APIRouter, HTTPException, Query

from app.api.deps import (
    AccessTokenDep,
    ListeningInsightsServiceDep,
    StatsServiceDep,
    UserServiceDep,
)
from app.domain import TimeRange, TopItemType
from app.api.schemas import (
    API_ERROR_RESPONSES,
    ArtistPaging,
    ListeningInsightsResponse,
    TrackPaging,
    UserProfile,
)
from app.exceptions import SpotifyApiError

router = APIRouter(prefix="/me", tags=["me"])


@router.get("", response_model=UserProfile, responses=API_ERROR_RESPONSES)
def get_profile(user: UserServiceDep, token: AccessTokenDep) -> UserProfile:
    """Profil des eingeloggten Users. Dient dem Frontend auch als Login-Check (401 = nicht eingeloggt)."""
    return user.get_profile(token)


@router.get(
    "/top/{item_type}",
    response_model=TrackPaging | ArtistPaging,
    responses=API_ERROR_RESPONSES,
)
def get_top(
    item_type: TopItemType,
    stats: StatsServiceDep,
    token: AccessTokenDep,
    limit: int = Query(10, ge=1, le=50),
    offset: int = Query(0, ge=0),
    time_range: TimeRange = "medium_term",
) -> TrackPaging | ArtistPaging:
    return stats.get_top(token, item_type, limit, offset, time_range)


@router.get(
    "/listening-insights",
    response_model=ListeningInsightsResponse,
    responses=API_ERROR_RESPONSES,
)
def get_listening_insights(
    insights: ListeningInsightsServiceDep,
    user: UserServiceDep,
    token: AccessTokenDep,
    time_range: TimeRange = "medium_term",
    timezone: str = Query("UTC", min_length=1, max_length=64),
) -> ListeningInsightsResponse:
    """Heatmap, Discovery Rate und Hörserien aus gespeicherten Hörereignissen."""
    profile = user.get_profile(token)
    try:
        return insights.get_insights(
            token,
            profile["id"],
            time_range,
            timezone
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except SpotifyApiError as exc:
        if exc.status_code == 403:
            raise HTTPException(
                status_code=403,
                detail=(
                    "Spotify verweigert den Zugriff auf deine Hörhistorie. "
                    "Bitte melde dich ab und erneut an, damit die Berechtigung "
                    "user-read-recently-played angefragt wird."
                ),
            ) from exc
        raise
