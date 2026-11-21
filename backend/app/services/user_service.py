from typing import Any

from app.clients.spotify_client import SpotifyClient


class UserService:
    def __init__(self, client: SpotifyClient):
        self._client = client

    def get_profile(self, access_token: str) -> dict[str, Any]:
        return self._client.get("/me", access_token)
