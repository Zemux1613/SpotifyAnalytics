import logging
from typing import Any

from app.clients.spotify_client import SpotifyClient
from app.exceptions import SpotifyApiError

logger = logging.getLogger(__name__)

MAX_ARTISTS = 5  # pro Track werden höchstens so viele Künstler nachgeladen


class TrackService:
    def __init__(self, client: SpotifyClient):
        self._client = client

    def search(self, access_token: str, query: str, limit: int) -> dict[str, Any]:
        return self._client.get(
            "/search", access_token, q=query, type="track", limit=limit
        )

    def get_details(self, access_token: str, track_id: str) -> dict[str, Any]:
        """Track plus die vollständigen Künstler-Objekte (Genres, Bilder).
        Der Track selbst enthält nur eine Kurzfassung der Künstler."""
        track = self._client.get(f"/tracks/{track_id}", access_token)

        artists: list[dict[str, Any]] = []
        for ref in track.get("artists", [])[:MAX_ARTISTS]:
            try:
                artists.append(self._client.get(f"/artists/{ref['id']}", access_token))
            except SpotifyApiError as e:
                if e.status_code == 401:
                    raise
                # fehlende Zusatzinfos sollen den Track nicht unbrauchbar machen
                logger.warning("künstler %s nicht ladbar: %s", ref.get("id"), e)
        return {"track": track, "artists": artists}
