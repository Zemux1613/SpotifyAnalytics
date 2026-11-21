"""Supervised Playlist-Klassifikation.

Für jede Playlist wird ein eigener Random-Forest-Klassifikator trainiert
(One-vs-Rest): positiv sind die Tracks, die in der Playlist liegen, negativ alle
übrigen Tracks aus den Playlists des Users. Als Features dienen die Genres der
Künstler sowie einfache Track-Metadaten (Popularität, Dauer, Erscheinungsjahr,
Albumtyp …). Die vorhergesagte Wahrscheinlichkeit wird als Passgenauigkeit in
Prozent ausgegeben.

Playlists mit zu wenig Trainingsdaten bekommen statt des Klassifikators eine
Genre-Ähnlichkeit als Fallback.
"""
from __future__ import annotations

from collections import Counter
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

import numpy as np
from sklearn.ensemble import RandomForestClassifier

MAX_GENRES = 120
MIN_POSITIVES = 3
MIN_NEGATIVES = 5
MAX_SUGGESTIONS = 8
RANDOM_STATE = 42
ALBUM_TYPES = ("album", "single", "compilation")


@dataclass
class TrainedPlaylist:
    playlist_id: str
    name: str
    image_url: str | None
    spotify_url: str | None
    track_count: int
    track_ids: set[str]
    estimator: RandomForestClassifier | None
    genre_vector: np.ndarray | None
    top_genres: list[str] = field(default_factory=list)
    genre_counts: list[tuple[str, int]] = field(default_factory=list)
    duration_ms: int = 0
    avg_release_year: int | None = None


def _artist_objects(
    track: dict[str, Any],
    artist_map: dict[str, dict[str, Any]],
    fallback: dict[str, dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    artists: list[dict[str, Any]] = []
    for ref in track.get("artists") or []:
        artist = artist_map.get(ref.get("id")) or (fallback or {}).get(ref.get("id"))
        if artist:
            artists.append(artist)
    return artists


def _genres(artists: list[dict[str, Any]]) -> set[str]:
    genres: set[str] = set()
    for artist in artists:
        genres.update(artist.get("genres") or [])
    return genres


def _release_year(track: dict[str, Any]) -> int:
    date = (track.get("album") or {}).get("release_date") or ""
    try:
        return int(date[:4])
    except (TypeError, ValueError):
        return 0


def _numeric_features(track: dict[str, Any], artists: list[dict[str, Any]]) -> list[float]:
    album = track.get("album") or {}
    album_type = album.get("album_type") or ""
    popularity = float(track.get("popularity") or 0)
    artist_popularities = [float(a.get("popularity") or 0) for a in artists]
    return [
        popularity / 100,
        float(track.get("duration_ms") or 0) / 60_000,
        1.0 if track.get("explicit") else 0.0,
        float(_release_year(track)),
        float(track.get("track_number") or 0),
        float(album.get("total_tracks") or 0),
        float(len(artists)),
        (sum(artist_popularities) / len(artist_popularities) / 100)
        if artist_popularities
        else 0.0,
        (max(artist_popularities) / 100) if artist_popularities else 0.0,
        *[1.0 if album_type == name else 0.0 for name in ALBUM_TYPES],
    ]


class PlaylistClassifier:
    """Trainiertes Modell über alle editierbaren Playlists eines Users."""

    def __init__(
        self,
        playlists: list[dict[str, Any]],
        tracks_by_playlist: dict[str, list[dict[str, Any]]],
        artist_map: dict[str, dict[str, Any]],
    ):
        self._trained_at = datetime.now(timezone.utc)
        self._playlists_total = len(playlists)
        self._artist_map = artist_map

        # eindeutige Tracks über alle Playlists hinweg
        unique_tracks: dict[str, dict[str, Any]] = {}
        playlist_track_ids: dict[str, set[str]] = {}
        for playlist in playlists:
            playlist_id = playlist.get("id")
            if not playlist_id:
                continue
            tracks = tracks_by_playlist.get(playlist_id) or []
            ids = {track["id"] for track in tracks if track.get("id")}
            playlist_track_ids[playlist_id] = ids
            for track in tracks:
                if track.get("id"):
                    unique_tracks.setdefault(track["id"], track)

        self._tracks_used = len(unique_tracks)

        track_genres: dict[str, set[str]] = {}
        genre_frequency: Counter[str] = Counter()
        for track_id, track in unique_tracks.items():
            genres = _genres(_artist_objects(track, artist_map))
            track_genres[track_id] = genres
            genre_frequency.update(genres)

        self._genre_index = {
            genre: index
            for index, (genre, _) in enumerate(genre_frequency.most_common(MAX_GENRES))
        }
        self._feature_vectors = {
            track_id: self._vector(track, track_genres[track_id])
            for track_id, track in unique_tracks.items()
        }

        matrix = (
            np.vstack(list(self._feature_vectors.values()))
            if self._feature_vectors
            else np.empty((0, self._feature_count), dtype=np.float32)
        )
        ordered_ids = list(self._feature_vectors)

        self._trained: list[TrainedPlaylist] = []
        for playlist in playlists:
            playlist_id = playlist.get("id")
            if not playlist_id:
                continue
            positive_ids = playlist_track_ids.get(playlist_id) or set()
            if not positive_ids:
                continue

            positives = sum(1 for track_id in ordered_ids if track_id in positive_ids)
            negatives = len(ordered_ids) - positives
            estimator: RandomForestClassifier | None = None
            if positives >= MIN_POSITIVES and negatives >= MIN_NEGATIVES:
                labels = np.fromiter(
                    (1 if track_id in positive_ids else 0 for track_id in ordered_ids),
                    dtype=np.int8,
                    count=len(ordered_ids),
                )
                estimator = RandomForestClassifier(
                    n_estimators=80,
                    max_depth=8,
                    min_samples_leaf=2,
                    max_features="sqrt",
                    class_weight="balanced_subsample",
                    random_state=RANDOM_STATE,
                    n_jobs=-1,
                )
                estimator.fit(matrix, labels)

            genre_profile: Counter[str] = Counter()
            for track_id in positive_ids:
                genre_profile.update(track_genres.get(track_id, set()))

            genre_vector = np.array(
                [genre_profile.get(genre, 0) for genre in self._genre_index],
                dtype=np.float32,
            )
            norm = float(np.linalg.norm(genre_vector))
            if norm > 0:
                genre_vector /= norm

            playlist_tracks = tracks_by_playlist.get(playlist_id) or []
            total_duration_ms = sum(int(t.get("duration_ms") or 0) for t in playlist_tracks)
            years = [y for t in playlist_tracks if (y := _release_year(t)) > 0]
            avg_year = round(sum(years) / len(years)) if years else None

            self._trained.append(
                TrainedPlaylist(
                    playlist_id=playlist_id,
                    name=playlist.get("name") or "Unbenannte Playlist",
                    image_url=_pick_image(playlist.get("images")),
                    spotify_url=(playlist.get("external_urls") or {}).get("spotify"),
                    track_count=int((playlist.get("tracks") or {}).get("total") or len(positive_ids)),
                    track_ids=set(positive_ids),
                    estimator=estimator,
                    genre_vector=genre_vector if norm > 0 else None,
                    top_genres=[genre for genre, _ in genre_profile.most_common(3)],
                    genre_counts=genre_profile.most_common(5),
                    duration_ms=total_duration_ms,
                    avg_release_year=avg_year,
                )
            )

    def playlist_genres(self) -> dict[str, list[dict[str, Any]]]:
        """Liefert die Top-Genres inkl. Anzahl und Anteil (0..1) pro Playlist-ID."""
        result: dict[str, list[dict[str, Any]]] = {}
        for pl in self._trained:
            if not pl.genre_counts:
                continue
            total = sum(count for _, count in pl.genre_counts) or 1
            result[pl.playlist_id] = [
                {"name": name, "count": count, "share": count / total}
                for name, count in pl.genre_counts
            ]
        return result

    def playlist_metrics(self) -> dict[str, dict[str, Any]]:
        """Liefert Track-IDs, Gesamtdauer und Ø-Erscheinungsjahr pro Playlist-ID."""
        return {
            pl.playlist_id: {
                "track_ids": pl.track_ids,
                "duration_ms": pl.duration_ms,
                "avg_release_year": pl.avg_release_year,
            }
            for pl in self._trained
        }

    @property
    def _feature_count(self) -> int:
        return len(_numeric_features({}, [])) + len(self._genre_index) + 1

    def _vector(
        self,
        track: dict[str, Any],
        genres: set[str],
        fallback: dict[str, dict[str, Any]] | None = None,
    ) -> np.ndarray:
        artists = _artist_objects(track, self._artist_map, fallback)
        numeric = _numeric_features(track, artists)
        genre_part = [1.0 if genre in genres else 0.0 for genre in self._genre_index]
        # Anzahl der Genres als zusätzliches Signal, gedämpft
        genre_count = min(len(genres), 10) / 10
        return np.array(numeric + genre_part + [genre_count], dtype=np.float32)

    def _genre_similarity(self, playlist: TrainedPlaylist, genres: set[str]) -> float:
        if playlist.genre_vector is None or not genres:
            return 0.0
        query = np.array(
            [1.0 if genre in genres else 0.0 for genre in self._genre_index],
            dtype=np.float32,
        )
        norm = float(np.linalg.norm(query))
        if norm == 0:
            return 0.0
        return float(np.dot(query / norm, playlist.genre_vector))

    def suggest(
        self,
        track: dict[str, Any],
        artists: list[dict[str, Any]] | None = None,
        limit: int = MAX_SUGGESTIONS,
    ) -> list[dict[str, Any]]:
        """Passgenauigkeit des Tracks für jede trainierte Playlist, absteigend sortiert."""
        fallback = {artist["id"]: artist for artist in artists or [] if artist.get("id")}
        genres = _genres(_artist_objects(track, self._artist_map, fallback))
        vector = self._vector(track, genres, fallback)
        track_id = track.get("id")

        suggestions: list[dict[str, Any]] = []
        for playlist in self._trained:
            if playlist.estimator is not None:
                probability = float(playlist.estimator.predict_proba(vector.reshape(1, -1))[0][1])
                method = "random_forest"
            else:
                probability = self._genre_similarity(playlist, genres)
                method = "genre_fallback"

            percent = int(round(max(0.0, min(1.0, probability)) * 100))
            suggestions.append(
                {
                    "playlist_id": playlist.playlist_id,
                    "name": playlist.name,
                    "image_url": playlist.image_url,
                    "spotify_url": playlist.spotify_url,
                    "track_count": playlist.track_count,
                    "match_percent": percent,
                    "method": method,
                    "already_in_playlist": track_id in playlist.track_ids,
                    "top_genres": playlist.top_genres,
                }
            )

        suggestions.sort(key=lambda item: (-item["match_percent"], item["name"].lower()))
        return suggestions[:limit]

    def mark_added(self, playlist_id: str, track_id: str) -> None:
        """Hält den Cache aktuell, ohne das komplette Modell neu zu trainieren."""
        for playlist in self._trained:
            if playlist.playlist_id == playlist_id:
                if track_id not in playlist.track_ids:
                    playlist.track_ids.add(track_id)
                    playlist.track_count += 1
                return

    def stats(self) -> dict[str, Any]:
        trained_count = sum(1 for p in self._trained if p.estimator is not None)
        return {
            "playlists_used": len(self._trained),
            "playlists_trained": trained_count,
            "playlists_total": self._playlists_total,
            "tracks_used": self._tracks_used,
            "genres": len(self._genre_index),
            "trained_at": self._trained_at.isoformat(),
        }


def _pick_image(images: list[dict[str, Any]] | None, target: int = 64) -> str | None:
    if not images:
        return None
    with_size = [img for img in images if img.get("url")]
    if not with_size:
        return None
    return min(
        with_size,
        key=lambda img: abs(int(img.get("width") or 0) - target),
    )["url"]