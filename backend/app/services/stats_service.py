from typing import Any

from app.clients.spotify_client import SpotifyClient
from app.domain import TimeRange, TopItemType


class StatsService:
    def __init__(self, client: SpotifyClient):
        self._client = client

    def get_top(
        self,
        access_token: str,
        item_type: TopItemType,
        limit: int,
        offset: int,
        time_range: TimeRange,
    ) -> dict[str, Any]:
        return self._client.get(
            f"/me/top/{item_type}",
            access_token,
            limit=limit,
            offset=offset,
            time_range=time_range,
        )
