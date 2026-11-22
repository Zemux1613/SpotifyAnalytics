import logging
import threading
import time
from collections import OrderedDict
from concurrent.futures import ThreadPoolExecutor
from typing import TYPE_CHECKING, Any

from app.clients.spotify_client import SpotifyClient
from app.exceptions import (
    InvalidRequestError,
    MissingPlaylistScopeError,
    SpotifyApiError,
)
from app.services.playlist_classifier import PlaylistClassifier
from app.services.playlist_service import PlaylistService

if TYPE_CHECKING:
    from app.services.audio_analysis_service import AudioAnalysisService

logger = logging.getLogger(__name__)

BPM_TOLERANCE = 8.0  # Abstand in BPM, ab dem Tempo nicht mehr als "passend" gilt
CACHE_TTL = 30 * 60  # sekunden
MAX_CACHED_MODELS = 8
FETCH_WORKERS = 4


class RecommenderService:
    """Baut und cached pro Session ein Playlist-Modell.

    Das Modell wird erst beim ersten Vorschlag trainiert (lazy) und danach für
    weitere Suchanfragen wiederverwendet. Ein Neustart des Backends verwirft es.
    """

    def __init__(self, client: SpotifyClient, playlists: PlaylistService):
        self._client = client
        self._playlists = playlists
        self._cache: OrderedDict[str, tuple[float, PlaylistClassifier]] = OrderedDict()
        self._cache_lock = threading.Lock()
        self._build_lock = threading.Lock()

    def get_suggestions(
        self,
        access_token: str,
        session_id: str | None,
        track: dict[str, Any],
        artists: list[dict[str, Any]],
        refresh: bool = False,
        audio: "AudioAnalysisService | None" = None,
    ) -> dict[str, Any]:
        model, cached = self._get_model(access_token, session_id, refresh)
        suggestions = model.suggest(track, artists)
        audio_ready = self._add_audio_reasons(model, suggestions, track.get("id"), audio)
        stats = model.stats()
        stats["cached"] = cached

        message = None
        if stats["playlists_used"] == 0:
            if stats["playlists_total"] == 0:
                message = (
                    "Es wurden keine editierbaren Playlists gefunden. "
                    "Lege eine Playlist an oder folge einer, die du bearbeiten darfst."
                )
            else:
                message = "In deinen Playlists sind noch zu wenig Songs für ein Modell."

        return {
            "track_id": track.get("id"),
            "suggestions": suggestions,
            "model": stats,
            "message": message,
            "audio_ready": audio_ready,
        }

    @staticmethod
    def _add_audio_reasons(
        model: PlaylistClassifier,
        suggestions: list[dict[str, Any]],
        track_id: str | None,
        audio: "AudioAnalysisService | None",
    ) -> bool:
        """Ergänzt BPM-/Stimmungs-Gründe, sofern Track und Playlist bereits analysiert sind."""
        if audio is None or not track_id:
            return False
        track_bpm, track_mood = audio.track_vibe(track_id)
        if track_bpm is None:
            return False

        metrics = model.playlist_metrics()
        for suggestion in suggestions:
            ids = (metrics.get(suggestion["playlist_id"]) or {}).get("track_ids") or []
            avg_bpm, dominant_mood = audio.playlist_vibe(ids)
            if avg_bpm:
                # librosa verwechselt gern halbes/doppeltes Tempo, beides gilt als passend
                gap = min(abs(track_bpm - avg_bpm), abs(track_bpm * 2 - avg_bpm), abs(track_bpm / 2 - avg_bpm))
                if gap <= BPM_TOLERANCE:
                    suggestion["reasons"].append(
                        {
                            "key": "bpm",
                            "label": "BPM passt",
                            "detail": f"{round(track_bpm)} vs. Ø {round(avg_bpm)} BPM",
                        }
                    )
            if dominant_mood and track_mood == dominant_mood:
                suggestion["reasons"].append(
                    {"key": "mood", "label": "Stimmung passt", "detail": dominant_mood}
                )
        return True

    def get_unsorted_tracks(
        self,
        access_token: str,
        session_id: str | None,
        limit: int,
    ) -> dict[str, Any]:
        """Lieblingssongs, die in keiner der trainierten (= bearbeitbaren) Playlists liegen."""
        model, _ = self._get_model(access_token, session_id, refresh=False)
        known = model.all_track_ids()
        saved = self._playlists.get_saved_tracks(access_token)
        unsorted = [track for track in saved if track.get("id") not in known]
        return {
            "tracks": unsorted[:limit],
            "total_unsorted": len(unsorted),
            "scanned": len(saved),
        }

    def get_model_status(self, access_token: str, session_id: str | None) -> dict[str, Any]:
        """Status des gecachten Modells, ohne es zu trainieren."""
        key = self._cache_key(access_token, session_id)
        with self._cache_lock:
            entry = self._cache.get(key)
        age = time.monotonic() - entry[0] if entry else None
        if entry is None or age >= CACHE_TTL:
            return {"trained": False, "model": None, "expires_in_seconds": None}
        stats = entry[1].stats()
        stats["cached"] = True
        return {
            "trained": True,
            "model": stats,
            "expires_in_seconds": max(0, int(CACHE_TTL - age)),
        }

    def train_model(self, access_token: str, session_id: str | None) -> dict[str, Any]:
        """Trainiert das Modell neu (wie refresh=true bei den Vorschlägen)."""
        self._get_model(access_token, session_id, refresh=True)
        return self.get_model_status(access_token, session_id)

    @staticmethod
    def _cache_key(access_token: str, session_id: str | None) -> str:
        return session_id or f"token:{hash(access_token)}"

    def add_track(
        self,
        access_token: str,
        session_id: str | None,
        playlist_id: str,
        track_uri: str,
    ) -> dict[str, Any]:
        if not track_uri.startswith("spotify:track:"):
            raise InvalidRequestError("track_uri muss eine Spotify-Track-URI sein")
        result = self._playlists.add_track(access_token, playlist_id, track_uri)

        # Cache aktuell halten, damit der Song nicht erneut als "fehlt" gilt.
        track_id = track_uri.rsplit(":", 1)[-1]
        with self._cache_lock:
            entry = self._cache.get(session_id or "")
            if entry:
                entry[1].mark_added(playlist_id, track_id)

        return {
            "status": "hinzugefügt",
            "snapshot_id": result.get("snapshot_id"),
        }

    def _get_model(
        self, access_token: str, session_id: str | None, refresh: bool
    ) -> tuple[PlaylistClassifier, bool]:
        key = self._cache_key(access_token, session_id)
        now = time.monotonic()

        with self._cache_lock:
            entry = self._cache.get(key)
            if entry and not refresh and now - entry[0] < CACHE_TTL:
                self._cache.move_to_end(key)
                return entry[1], True

        # Nur ein Modell gleichzeitig trainieren; danach prüfen, ob ein anderer
        # paralleler Request inzwischen fertig ist.
        with self._build_lock:
            with self._cache_lock:
                entry = self._cache.get(key)
                if entry and not refresh and now - entry[0] < CACHE_TTL:
                    self._cache.move_to_end(key)
                    return entry[1], True

            logger.info("playlist-modell wird trainiert")
            started = time.perf_counter()
            model = self._build(access_token)
            logger.info("playlist-modell trainiert in %.1fs", time.perf_counter() - started)

            with self._cache_lock:
                self._cache[key] = (time.monotonic(), model)
                self._cache.move_to_end(key)
                while len(self._cache) > MAX_CACHED_MODELS:
                    self._cache.pop(next(iter(self._cache)))
            return model, False

    def _build(self, access_token: str) -> PlaylistClassifier:
        try:
            profile = self._client.get("/me", access_token)
            playlists = self._playlists.list_playlists(access_token)
        except SpotifyApiError as e:
            if e.status_code == 403:
                raise MissingPlaylistScopeError() from e
            raise

        user_id = profile.get("id")
        editable = [
            playlist
            for playlist in playlists
            if self._is_editable(playlist, user_id)
        ]

        tracks_by_playlist: dict[str, list[dict[str, Any]]] = {}
        with ThreadPoolExecutor(max_workers=FETCH_WORKERS) as pool:
            results = pool.map(
                lambda playlist: (
                    playlist["id"],
                    self._playlists.get_playlist_tracks(access_token, playlist["id"]),
                ),
                editable,
            )
            for playlist_id, tracks in results:
                tracks_by_playlist[playlist_id] = tracks

        artist_ids = {
            artist["id"]
            for tracks in tracks_by_playlist.values()
            for track in tracks
            for artist in track.get("artists") or []
            if artist.get("id")
        }
        artist_map = self._playlists.get_artists(access_token, artist_ids)
        return PlaylistClassifier(editable, tracks_by_playlist, artist_map)

    @staticmethod
    def _is_editable(playlist: dict[str, Any], user_id: str | None) -> bool:
        if not playlist.get("id"):
            return False
        if playlist.get("collaborative"):
            return True
        owner = (playlist.get("owner") or {}).get("id")
        # ohne bekannte user-id lieber alles behalten und Spotify entscheiden lassen
        return user_id is None or owner == user_id

    def train_model(self, access_token: str, session_id: str | None) -> dict[str, Any]:
        """Trainiert das Modell neu (wie refresh=true bei den Vorschlägen)."""
        self._get_model(access_token, session_id, refresh=True)
        return self.get_model_status(access_token, session_id)

    def get_playlist_genre_overview(
        self, access_token: str, session_id: str | None
    ) -> tuple[str, dict[str, list[dict[str, Any]]], dict[str, dict[str, Any]], bool]:
        """Liefert (user_id, genres_by_playlist, metrics_by_playlist, model_trained)."""
        profile = self._client.get("/me", access_token)
        user_id = profile.get("id") or ""

        key = self._cache_key(access_token, session_id)
        with self._cache_lock:
            entry = self._cache.get(key)
        age = time.monotonic() - entry[0] if entry else None

        if entry is None or age >= CACHE_TTL:
            return user_id, {}, {}, False

        return user_id, entry[1].playlist_genres(), entry[1].playlist_metrics(), True