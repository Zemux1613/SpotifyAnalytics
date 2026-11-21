"""Asynchrone Preview-Analyse mit kleinem prozesslokalem Ergebnis-Cache.

FastAPI führt die synchrone Analyse nach der HTTP-Antwort in einem Worker-Thread
als BackgroundTask aus. Für einen einzelnen API-Prozess ist das ausreichend;
bei mehreren Workern oder dauerhafter Speicherung sollte der Store später durch
Redis/eine Datenbank und die Tasks durch eine Queue ersetzt werden.
"""

from __future__ import annotations

import io
import logging
import subprocess
import threading
from typing import Any
from urllib.parse import urlparse

import numpy as np
import requests
from fastapi import BackgroundTasks
from sklearn.cluster import KMeans

from app.api.schemas import AudioAnalysisResponse, AudioFeatures, AudioRadarValues

logger = logging.getLogger(__name__)

_ALLOWED_PREVIEW_HOSTS = {"p.scdn.co", "audio-ak-spotify-com.akamaized.net"}
_ALLOWED_PREVIEW_HOST_SUFFIXES = (".dzcdn.net",)  # Deezer-Preview-CDN
_DEEZER_API = "https://api.deezer.com"
_DEEZER_TIMEOUT = (3, 5)
_MAX_PREVIEW_BYTES = 15 * 1024 * 1024
_DOWNLOAD_TIMEOUT = (5, 15)


class AudioAnalysisService:
    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._jobs: dict[str, AudioAnalysisResponse] = {}
        self._feature_vectors: dict[str, list[float]] = {}

    @staticmethod
    def resolve_preview_url(track: dict[str, Any]) -> str | None:
        """Spotify liefert für neuere Apps kein preview_url mehr (immer null).
        Fallback: 30s-Preview von Deezer, gefunden über ISRC bzw. Titel+Künstler."""
        if track.get("preview_url"):
            return track["preview_url"]

        isrc = (track.get("external_ids") or {}).get("isrc")
        if isrc:
            url = AudioAnalysisService._deezer_preview(f"/track/isrc:{isrc}")
            if url:
                return url

        name = track.get("name")
        artists = track.get("artists") or []
        artist = artists[0].get("name") if artists else None
        if name and artist:
            query = f'artist:"{artist}" track:"{name}"'
            return AudioAnalysisService._deezer_preview("/search", q=query, limit=1)
        return None

    @staticmethod
    def _deezer_preview(path: str, **params: Any) -> str | None:
        try:
            response = requests.get(
                f"{_DEEZER_API}{path}", params=params, timeout=_DEEZER_TIMEOUT
            )
            response.raise_for_status()
            data = response.json()
        except (requests.RequestException, ValueError):
            logger.warning("Deezer-Lookup fehlgeschlagen: %s", path)
            return None
        if "data" in data:  # Such-Antwort
            data = data["data"][0] if data["data"] else {}
        return data.get("preview") or None  # Fehler-Objekt/leer -> None

    def enqueue(
        self, track_id: str, preview_url: str | None, background_tasks: BackgroundTasks
    ) -> AudioAnalysisResponse:
        with self._lock:
            current = self._jobs.get(track_id)
            if current and current.status in {"queued", "processing", "completed"}:
                return current
            if not preview_url:
                result = AudioAnalysisResponse(
                    track_id=track_id,
                    status="unavailable",
                    message="Für diesen Track gibt es weder bei Spotify noch bei Deezer ein Preview-Snippet.",
                )
                self._jobs[track_id] = result
                return result
            self._jobs[track_id] = AudioAnalysisResponse(
                track_id=track_id, status="queued", message="Analyse wurde eingeplant."
            )
            background_tasks.add_task(self._analyse, track_id, preview_url)
            return self._jobs[track_id]

    def summary(self, track_ids: list[str]) -> list[dict[str, Any]]:
        """Status und Tempo je Track (ohne Analyse -> not_started), in Anfrage-Reihenfolge."""
        with self._lock:
            result = []
            for track_id in dict.fromkeys(track_ids):  # Duplikate raus, Reihenfolge bleibt
                job = self._jobs.get(track_id)
                tempo = job.features.tempo_bpm if job and job.features else None
                result.append(
                    {
                        "track_id": track_id,
                        "status": job.status if job else "not_started",
                        "tempo_bpm": tempo,
                    }
                )
            return result

    def playlist_vibe(self, track_ids: Iterable[str]) -> tuple[float | None, str | None]:
        """Berechnet Ø-BPM und dominante Stimmung aus bereits abgeschlossenen Track-Analysen."""
        from collections import Counter

        bpms: list[float] = []
        moods: Counter[str] = Counter()
        with self._lock:
            for tid in track_ids:
                job = self._jobs.get(tid)
                if job and job.status == "completed" and job.features:
                    bpms.append(job.features.tempo_bpm)
                    if job.features.mood:
                        moods[job.features.mood] += 1

        if not bpms:
            return None, None
        avg_bpm = round(sum(bpms) / len(bpms), 1)
        dominant_mood = moods.most_common(1)[0][0] if moods else None
        return avg_bpm, dominant_mood

    def get_status(self, track_id: str) -> AudioAnalysisResponse:
        with self._lock:
            return self._jobs.get(
                track_id,
                AudioAnalysisResponse(
                    track_id=track_id,
                    status="unavailable",
                    message="Für diesen Track wurde noch keine Audio-Analyse gestartet.",
                ),
            )

    def _analyse(self, track_id: str, preview_url: str) -> None:
        with self._lock:
            self._jobs[track_id] = AudioAnalysisResponse(
                track_id=track_id, status="processing", message="Audio wird analysiert."
            )
        try:
            audio = self._download_preview(preview_url)
            features = self._extract_features(audio)
            with self._lock:
                self._feature_vectors[track_id] = [
                    features.radar.tempo,
                    features.radar.brightness,
                    features.radar.rhythm,
                    features.radar.texture,
                ]
                self._apply_mood_clustering(track_id, features)
                self._jobs[track_id] = AudioAnalysisResponse(
                    track_id=track_id,
                    status="completed",
                    features=features,
                    message="Audio-Analyse abgeschlossen.",
                )
        except Exception as exc:  # Fehler dürfen den BackgroundTask nicht crashen lassen
            logger.exception("Audio-Analyse für Track %s fehlgeschlagen", track_id)
            with self._lock:
                self._jobs[track_id] = AudioAnalysisResponse(
                    track_id=track_id,
                    status="failed",
                    message=f"Audio-Analyse fehlgeschlagen: {type(exc).__name__}",
                )

    @staticmethod
    def _download_preview(url: str) -> bytes:
        parsed = urlparse(url)
        host = parsed.hostname or ""
        if parsed.scheme != "https" or not (
            host in _ALLOWED_PREVIEW_HOSTS or host.endswith(_ALLOWED_PREVIEW_HOST_SUFFIXES)
        ):
            raise ValueError("Nicht erlaubter Spotify-Preview-Host")

        response = requests.get(
            url, timeout=_DOWNLOAD_TIMEOUT, stream=True, allow_redirects=False
        )
        response.raise_for_status()
        content_length = response.headers.get("Content-Length")
        if content_length and int(content_length) > _MAX_PREVIEW_BYTES:
            raise ValueError("Preview-Datei ist zu groß")

        chunks: list[bytes] = []
        total = 0
        for chunk in response.iter_content(chunk_size=64 * 1024):
            if not chunk:
                continue
            total += len(chunk)
            if total > _MAX_PREVIEW_BYTES:
                raise ValueError("Preview-Datei ist zu groß")
            chunks.append(chunk)
        if not chunks:
            raise ValueError("Preview-Datei ist leer")
        return b"".join(chunks)

    @staticmethod
    def _extract_features(audio: bytes) -> AudioFeatures:
        # Import erst beim tatsächlichen Bedarf: Tracks ohne Preview benötigen
        # librosa nicht und der API-Start bleibt auch bei optionalem Audio-Stack robust.
        import librosa

        samples, sample_rate = _decode_audio(audio)
        if samples.size == 0:
            raise ValueError("Audio-Snippet enthält keine Samples")

        tempo = float(np.asarray(librosa.feature.tempo(y=samples, sr=sample_rate)).mean())
        centroid = float(librosa.feature.spectral_centroid(y=samples, sr=sample_rate).mean())
        zcr = float(librosa.feature.zero_crossing_rate(y=samples).mean())
        mfcc = librosa.feature.mfcc(y=samples, sr=sample_rate, n_mfcc=13)
        mfcc_mean = np.mean(mfcc, axis=1).astype(float).tolist()

        radar = AudioRadarValues(
            tempo=_scale(tempo, 60.0, 180.0),
            brightness=_scale(centroid, 0.0, 5_000.0),
            rhythm=_scale(zcr, 0.0, 0.20),
            texture=_scale(float(np.std(mfcc[1:, :])), 0.0, 100.0),
        )
        return AudioFeatures(
            tempo_bpm=round(tempo, 1),
            spectral_centroid_hz=round(centroid, 1),
            zero_crossing_rate=round(zcr, 4),
            mfcc=[round(value, 3) for value in mfcc_mean],
            radar=radar,
            mood=_mood_from_vector(tempo, radar.brightness, radar.rhythm),
            clustering_method="heuristic",
        )

    def _apply_mood_clustering(self, track_id: str, features: AudioFeatures) -> None:
        """Clustert bekannte Tracks gemeinsam; vor drei Tracks Heuristik verwenden."""
        if len(self._feature_vectors) < 3:
            return
        ids = list(self._feature_vectors)
        matrix = np.asarray([self._feature_vectors[item] for item in ids], dtype=float)
        if np.unique(matrix, axis=0).shape[0] < 3:
            return
        model = KMeans(n_clusters=3, random_state=42, n_init=10)
        labels = model.fit_predict(matrix)
        cluster = int(labels[ids.index(track_id)])
        center = model.cluster_centers_[cluster]
        features.mood = _mood_from_vector(60.0 + float(center[0]) * 1.2, float(center[1]), float(center[2]))
        features.clustering_method = "kmeans"


def _decode_audio(audio: bytes, sr: int = 22_050) -> tuple[np.ndarray, int]:
    """mp3 (Deezer) per ffmpeg-Pipe nach mono float32 dekodieren.
    libsndfile erkennt die Preview-mp3s aus einem BytesIO nicht zuverlässig."""
    try:
        proc = subprocess.run(
            ["ffmpeg", "-v", "error", "-i", "pipe:0",
             "-f", "f32le", "-ac", "1", "-ar", str(sr), "pipe:1"],
            input=audio, capture_output=True, timeout=30, check=True,
        )
        return np.frombuffer(proc.stdout, dtype=np.float32), sr
    except FileNotFoundError:  # kein ffmpeg installiert -> alter Weg (klappt z.B. bei wav/ogg)
        import librosa

        return librosa.load(io.BytesIO(audio), sr=sr, mono=True)
    except subprocess.CalledProcessError as exc:
        raise ValueError(f"ffmpeg-Dekodierung fehlgeschlagen: {exc.stderr[:200]!r}") from exc


def _scale(value: float, lower: float, upper: float) -> float:
    return round(max(0.0, min(100.0, (value - lower) / (upper - lower) * 100.0)), 1)


def _mood_from_vector(tempo: float, brightness: float, rhythm: float) -> str:
    if tempo >= 125 and rhythm >= 40:
        return "Workout"
    if tempo <= 95 and brightness <= 45:
        return "Melancholisch"
    return "Deep Focus"
