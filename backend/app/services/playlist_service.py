import logging
from collections.abc import Iterable
from typing import Any

from app.clients.spotify_client import SpotifyClient
from app.exceptions import MissingLibraryScopeError, SpotifyApiError
from app.api.schemas import (
    ArtistRef,
    PlaylistDetailResponse,
    PlaylistGenreItem,
    PlaylistOverviewItem,
    PlaylistTrackItem,
    PlaylistsOverviewResponse,
)

logger = logging.getLogger(__name__)

MAX_PLAYLISTS = 50  # harte Obergrenze, damit das Training nicht ausufert
MAX_TRACKS_PER_PLAYLIST = 300
MAX_SAVED_TRACKS = 500  # so viele Lieblingssongs (neueste zuerst) werden nach "unsortiert" durchsucht
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

    def get_saved_tracks(self, access_token: str, limit: int = MAX_SAVED_TRACKS) -> list[dict[str, Any]]:
        """Lieblingssongs des Users, neueste zuerst."""
        tracks: list[dict[str, Any]] = []
        offset = 0
        try:
            while len(tracks) < limit:
                page = self._client.get(
                    "/me/tracks", access_token, limit=min(50, limit - len(tracks)), offset=offset
                )
                batch = page.get("items") or []
                for item in batch:
                    track = item.get("track")
                    if track and not track.get("is_local") and track.get("id"):
                        tracks.append(track)
                if not page.get("next") or not batch:
                    break
                offset += len(batch)
        except SpotifyApiError as e:
            if e.status_code == 403:
                raise MissingLibraryScopeError() from e
            raise
        return tracks

    def get_playlist_detail(
        self, access_token: str, playlist_id: str
    ) -> PlaylistDetailResponse:
        """Playlist inkl. Songliste für die Detailansicht im Frontend."""
        playlist = self._client.get(f"/playlists/{playlist_id}", access_token)
        images = playlist.get("images") or []
        owner = playlist.get("owner") or {}

        tracks: list[PlaylistTrackItem] = []
        offset = 0
        while True:
            page = self._client.get(
                f"/playlists/{playlist_id}/tracks",
                access_token,
                limit=100,
                offset=offset,
            )
            batch = page.get("items") or []
            for item in batch:
                track = item.get("track") or {}
                if track.get("is_local") or not track.get("id"):
                    continue

                album = track.get("album") or {}
                album_images = album.get("images") or []
                artists = [
                    ArtistRef(
                        id=artist["id"],
                        name=artist.get("name") or "",
                        uri=artist.get("uri") or "",
                        external_urls=artist.get("external_urls"),
                    )
                    for artist in track.get("artists") or []
                    if artist.get("id")
                ]
                tracks.append(
                    PlaylistTrackItem(
                        id=track["id"],
                        name=track.get("name") or "",
                        uri=track.get("uri") or f"spotify:track:{track['id']}",
                        duration_ms=track.get("duration_ms") or 0,
                        artists=artists,
                        album_name=album.get("name"),
                        image_url=album_images[0]["url"] if album_images else None,
                        spotify_url=(track.get("external_urls") or {}).get("spotify"),
                        added_at=item.get("added_at"),
                    )
                )
            if not page.get("next") or not batch:
                break
            offset += len(batch)

        return PlaylistDetailResponse(
            id=playlist.get("id") or playlist_id,
            name=playlist.get("name") or "",
            description=playlist.get("description"),
            image_url=images[0]["url"] if images else None,
            spotify_url=(playlist.get("external_urls") or {}).get("spotify"),
            owner_name=owner.get("display_name") or owner.get("id"),
            track_count=(playlist.get("tracks") or {}).get("total") or len(tracks),
            tracks=tracks,
        )

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
                    avg_radar=pl_metrics.get("avg_radar"),
                )
            )

        return PlaylistsOverviewResponse(
            items=items,
            model_trained=model_trained,
        )