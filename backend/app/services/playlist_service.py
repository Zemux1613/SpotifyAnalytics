import logging
from collections.abc import Iterable
from typing import Any

from app.clients.spotify_client import SpotifyClient
from app.api.schemas import PlaylistGenreItem, PlaylistOverviewItem, PlaylistsOverviewResponse

logger = logging.getLogger(__name__)

MAX_PLAYLISTS = 50  # harte Obergrenze, damit das Training nicht ausufert
MAX_TRACKS_PER_PLAYLIST = 300
ARTIST_BATCH = 50  # spotify erlaubt bei /artists maximal 50 ids pro aufruf


class PlaylistService:
    """Zugriff auf die Playlists des Users und die zugehörigen Künstlerdaten."""

    def __init__(self, client: SpotifyClient):
        self._client = client

    def list_playlists(self, access_token: str, limit: int = MAX_PLAYLISTS) -> list[dict[str, Any]]:
        """Alle gefolgten Playlists, seitenweise bis zum Limit."""
        playlists: list[dict[str, Any]] = []
        offset = 0
        while len(playlists) < limit:
            page = self._client.get(
                "/me/playlists",
                access_token,
                limit=min(50, limit - len(playlists)),
                offset=offset,
            )
            batch = [item for item in page.get("items") or [] if item]
            playlists.extend(batch)
            if not page.get("next") or not batch:
                break
            offset += len(batch)
        return playlists[:limit]

    def get_playlist_tracks(
        self,
        access_token: str,
        playlist_id: str,
        limit: int = MAX_TRACKS_PER_PLAYLIST,
    ) -> list[dict[str, Any]]:
        """Tracks einer Playlist. Lokale Dateien und entfernte Einträge werden übersprungen."""
        tracks: list[dict[str, Any]] = []
        offset = 0
        while len(tracks) < limit:
            page = self._client.get(
                f"/playlists/{playlist_id}/tracks",
                access_token,
                limit=min(100, limit - len(tracks)),
                offset=offset,
            )
            batch = page.get("items") or []
            for item in batch:
                track = item.get("track")
                if not track or track.get("is_local") or not track.get("id"):
                    continue
                tracks.append(track)
            if not page.get("next") or not batch:
                break
            offset += len(batch)
        return tracks

    def get_artists(
        self, access_token: str, artist_ids: Iterable[str]
    ) -> dict[str, dict[str, Any]]:
        """Lädt die vollständigen Künstlerobjekte (inkl. Genres) in Batches."""
        unique_ids = list(dict.fromkeys(artist_ids))
        artists: dict[str, dict[str, Any]] = {}
        for start in range(0, len(unique_ids), ARTIST_BATCH):
            chunk = unique_ids[start : start + ARTIST_BATCH]
            data = self._client.get("/artists", access_token, ids=",".join(chunk))
            for artist in data.get("artists") or []:
                if artist and artist.get("id"):
                    artists[artist["id"]] = artist
        return artists

    def add_track(self, access_token: str, playlist_id: str, track_uri: str) -> dict[str, Any]:
        return self._client.post(
            f"/playlists/{playlist_id}/tracks",
            access_token,
            {"uris": [track_uri]},
        )

    def get_playlists_overview(
        self,
        access_token: str,
        user_id: str,
        genres_by_playlist: dict[str, list[PlaylistGenreItem]],
        metrics_by_playlist: dict[str, dict[str, Any]],
        model_trained: bool,
        include_followed: bool = False,
    ) -> PlaylistsOverviewResponse:
        raw_playlists = self.list_playlists(access_token)

        items: list[PlaylistOverviewItem] = []
        for pl in raw_playlists:
            owner_id = pl.get("owner", {}).get("id", "")
            is_owned = owner_id == user_id
            if not include_followed and not is_owned:
                continue

            pl_genres = genres_by_playlist.get(pl["id"], [])
            pl_metrics = metrics_by_playlist.get(pl["id"], {})
            images = pl.get("images") or []
            items.append(
                PlaylistOverviewItem(
                    id=pl["id"],
                    name=pl["name"],
                    image_url=images[0]["url"] if images else None,
                    spotify_url=pl.get("external_urls", {}).get("spotify"),
                    tracks_total=pl.get("tracks", {}).get("total", 0),
                    owner_name=pl.get("owner", {}).get("display_name") or owner_id,
                    is_owned=is_owned,
                    in_model=len(pl_genres) > 0,
                    genres=pl_genres[:5],
                    duration_ms=pl_metrics.get("duration_ms"),
                    avg_release_year=pl_metrics.get("avg_release_year"),
                    avg_bpm=pl_metrics.get("avg_bpm"),
                    dominant_mood=pl_metrics.get("dominant_mood"),
                )
            )

        return PlaylistsOverviewResponse(
            items=items,
            model_trained=model_trained,
        )