from typing import Any

from fastapi import APIRouter, Query

from app.api.deps import AccessTokenDep, StatsServiceDep, UserServiceDep
from app.domain import TimeRange, TopItemType

router = APIRouter(prefix="/me", tags=["me"])


@router.get("")
def get_profile(user: UserServiceDep, token: AccessTokenDep) -> dict[str, Any]:
    """Profil des eingeloggten Users. Dient dem Frontend auch als Login-Check (401 = nicht eingeloggt)."""
    return user.get_profile(token)


@router.get("/top/{item_type}")
def get_top(
    item_type: TopItemType,
    stats: StatsServiceDep,
    token: AccessTokenDep,
    limit: int = Query(10, ge=1, le=50),
    offset: int = Query(0, ge=0),
    time_range: TimeRange = "medium_term",
) -> dict[str, Any]:
    return stats.get_top(token, item_type, limit, offset, time_range)
