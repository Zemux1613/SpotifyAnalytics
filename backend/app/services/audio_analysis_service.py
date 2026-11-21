"""Asynchrone Preview-Analyse mit kleinem prozesslokalem Ergebnis-Cache.

FastAPI führt die synchrone Analyse nach der HTTP-Antwort in einem Worker-Thread
als BackgroundTask aus. Für einen einzelnen API-Prozess ist das ausreichend;
bei mehreren Workern oder dauerhafter Speicherung sollte der Store später durch
Redis/eine Datenbank und die Tasks durch eine Queue ersetzt werden.
"""

from __future__ import annotations

import io
import logging
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
_MAX_PREVIEW_BYTES = 15 * 1024 * 1024
_DOWNLOAD_TIMEOUT = (5, 15)


class AudioAnalysisService:
    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._jobs: dict[str, AudioAnalysisResponse] = {}
        self._feature_vectors: dict[str, list[float]] = {}

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
                    message="Für diesen Track stellt Spotify kein Preview-Snippet bereit.",
                )
                self._jobs[track_id] = result
                return result
            self._jobs[track_id] = AudioAnalysisResponse(
                track_id=track_id, status="queued", message="Analyse wurde eingeplant."
            )
            background_tasks.add_task(self._analyse, track_id, preview_url)
            return self._jobs[track_id]

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
        if parsed.scheme != "https" or parsed.hostname not in _ALLOWED_PREVIEW_HOSTS:
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

        samples, sample_rate = librosa.load(io.BytesIO(audio), sr=22_050, mono=True)
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


def _scale(value: float, lower: float, upper: float) -> float:
    return round(max(0.0, min(100.0, (value - lower) / (upper - lower) * 100.0)), 1)


def _mood_from_vector(tempo: float, brightness: float, rhythm: float) -> str:
    if tempo >= 125 and rhythm >= 40:
        return "Workout"
    if tempo <= 95 and brightness <= 45:
        return "Melancholisch"
    return "Deep Focus"
