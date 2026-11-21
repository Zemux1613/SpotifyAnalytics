from fastapi import APIRouter, Query

from app.api.deps import AccessTokenDep, StatsServiceDep, UserServiceDep
from app.domain import TimeRange, TopItemType
from app.api.schemas import API_ERROR_RESPONSES, ArtistPaging, TrackPaging, UserProfile

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
