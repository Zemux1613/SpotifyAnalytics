import logging
from typing import Any

from app.api.schemas import ArtistRef, NowPlayingResponse, NowPlayingTrack
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

    def get_now_playing(self, access_token: str) -> NowPlayingResponse:
        """Aktuell auf Spotify laufender Track (auf einem beliebigen Gerät des Users)."""
        data = self._client.get("/me/player/currently-playing", access_token)
        item = data.get("item") or {}

        # Podcast-Episoden haben kein Album und lassen sich nicht als Track öffnen.
        if item.get("type") != "track" or not item.get("id"):
            return NowPlayingResponse(
                is_playing=bool(data.get("is_playing")),
                progress_ms=data.get("progress_ms"),
            )

        album = item.get("album") or {}
        images = album.get("images") or []
        artists = [
            ArtistRef(
                id=artist["id"],
                name=artist.get("name") or "",
                uri=artist.get("uri") or "",
                external_urls=artist.get("external_urls"),
            )
            for artist in item.get("artists") or []
            if artist.get("id")
        ]

        return NowPlayingResponse(
            is_playing=bool(data.get("is_playing")),
            progress_ms=data.get("progress_ms"),
            track=NowPlayingTrack(
                id=item["id"],
                name=item.get("name") or "",
                uri=item.get("uri") or f"spotify:track:{item['id']}",
                duration_ms=item.get("duration_ms") or 0,
                artists=artists,
                album_name=album.get("name"),
                image_url=images[0]["url"] if images else None,
                spotify_url=(item.get("external_urls") or {}).get("spotify"),
            ),
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
