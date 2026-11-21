"""Erfasst Spotify-Hörereignisse und berechnet daraus Dashboard-Insights.

Spotify stellt über recently-played nur die letzten 50 Tracks bereit. Die
Antwort wird deshalb bei jedem Aufruf lokal gespeichert; eine vollständige
Historie vor dem ersten Aufruf kann nicht rekonstruiert werden.
"""

import json
import os
import sqlite3
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from app.clients.spotify_client import SpotifyClient
from app.domain import TimeRange

DAILY_DAYS = 14

RANGE_DAYS = {
    TimeRange.SHORT_TERM: 28,
    TimeRange.MEDIUM_TERM: 180,
    TimeRange.LONG_TERM: 365,
}


class ListeningInsightsService:
    def __init__(self, client: SpotifyClient):
        self._client = client
        self._database = Path(os.getenv("LISTENING_HISTORY_DB", "data/listening_history.sqlite3"))
        self._database.parent.mkdir(parents=True, exist_ok=True)
        self._initialize_database()

    def get_insights(
        self, access_token: str, user_id: str, time_range: TimeRange, timezone_name: str
    ) -> dict[str, Any]:
        try:
            user_timezone = ZoneInfo(timezone_name)
        except (ZoneInfoNotFoundError, ValueError) as exc:
            raise ValueError("Ungültige Zeitzone.") from exc

        response = self._client.get(
            "/me/player/recently-played", access_token, limit=50
        )
        recent_items = response.get("items") or []
        self._store_recent_plays(user_id, recent_items)

        with self._connect() as connection:
            rows = connection.execute(
                "SELECT track_id, played_at, artist_ids, duration_ms FROM plays "
                "WHERE user_id = ? ORDER BY played_at ASC",
                (user_id,),
            ).fetchall()

        now = datetime.now(user_timezone)
        days = RANGE_DAYS[time_range]
        current_start = now - timedelta(days=days)
        previous_start = current_start - timedelta(days=days)

        events = [
            {
                "track_id": row[0],
                "played_at": datetime.fromisoformat(row[1]).astimezone(user_timezone),
                "artist_ids": json.loads(row[2]),
                "duration_ms": row[3],
            }
            for row in rows
        ]
        current_events = [event for event in events if current_start <= event["played_at"] <= now]
        previous_events = [
            event for event in events
            if previous_start <= event["played_at"] < current_start
        ]

        first_track_play: dict[str, datetime] = {}
        first_artist_play: dict[str, datetime] = {}
        for event in events:
            track_id = event["track_id"]
            first_track_play.setdefault(track_id, event["played_at"])
            for artist_id in event["artist_ids"]:
                first_artist_play.setdefault(artist_id, event["played_at"])

        current_discovery = self._discovery(current_events, first_track_play, first_artist_play, current_start, now)
        previous_discovery = self._discovery(previous_events, first_track_play, first_artist_play, previous_start, current_start)

        heatmap = [[0 for _ in range(24)] for _ in range(7)]
        for event in current_events:
            played_at = event["played_at"]
            heatmap[played_at.weekday()][played_at.hour] += 1

        daily = self._daily(events, now.date())

        play_dates = sorted({event["played_at"].date() for event in events})
        current_streak, longest_streak = self._streaks(play_dates, now.date())
        oldest_play = events[0]["played_at"] if events else None

        return {
            "time_range": time_range.value,
            "timezone": timezone_name,
            "sample_size": len(events),
            "fetched_items": len(recent_items),
            "oldest_played_at": oldest_play.isoformat() if oldest_play else None,
            "heatmap": [
                {"weekday": weekday, "hour": hour, "count": heatmap[weekday][hour]}
                for weekday in range(7) for hour in range(24)
            ],
            "discovery": {
                "tracks_rate": current_discovery["tracks_rate"],
                "tracks_count": current_discovery["tracks_count"],
                "tracks_discovered": current_discovery["tracks_discovered"],
                "tracks_previous_rate": previous_discovery["tracks_rate"],
                "tracks_change_pp": self._change(current_discovery["tracks_rate"], previous_discovery["tracks_rate"]),
                "artists_rate": current_discovery["artists_rate"],
                "artists_count": current_discovery["artists_count"],
                "artists_discovered": current_discovery["artists_discovered"],
                "artists_previous_rate": previous_discovery["artists_rate"],
                "artists_change_pp": self._change(current_discovery["artists_rate"], previous_discovery["artists_rate"]),
            },
            "streak": {
                "current_days": current_streak,
                "longest_days": longest_streak,
                "tracked_since": oldest_play.date().isoformat() if oldest_play else None,
            },
            "daily": daily,
        }

    @staticmethod
    def _daily(events: list[dict[str, Any]], today: Any, days: int = DAILY_DAYS) -> list[dict[str, Any]]:
        """Hördauer pro Kalendertag (Zeitzone des Users). Tracks ohne bekannte Länge zählen 0 Minuten."""
        minutes: dict[Any, float] = {}
        plays: dict[Any, int] = {}
        for event in events:
            day = event["played_at"].date()
            plays[day] = plays.get(day, 0) + 1
            minutes[day] = minutes.get(day, 0.0) + (event["duration_ms"] or 0) / 60_000
        series = []
        for offset in range(days - 1, -1, -1):
            day = today - timedelta(days=offset)
            series.append(
                {"date": day.isoformat(), "minutes": round(minutes.get(day, 0.0), 1), "plays": plays.get(day, 0)}
            )
        return series

    def _store_recent_plays(self, user_id: str, items: list[dict[str, Any]]) -> None:
        with self._connect() as connection:
            for item in items:
                track = item.get("track") or {}
                played_at = item.get("played_at")
                track_id = track.get("id")
                if not track_id or not played_at:
                    continue
                timestamp = datetime.fromisoformat(played_at.replace("Z", "+00:00")).astimezone(timezone.utc)
                artist_ids = sorted({artist["id"] for artist in (track.get("artists") or []) if artist.get("id")})
                duration_ms = track.get("duration_ms")
                key = (user_id, track_id, timestamp.isoformat())
                connection.execute(
                    "INSERT OR IGNORE INTO plays (user_id, track_id, played_at, artist_ids, duration_ms) "
                    "VALUES (?, ?, ?, ?, ?)",
                    (*key, json.dumps(artist_ids), duration_ms),
                )
                if duration_ms is not None:
                    # Altbestand aus der Zeit vor der Dauer-Spalte nachtragen
                    connection.execute(
                        "UPDATE plays SET duration_ms = ? WHERE user_id = ? AND track_id = ? "
                        "AND played_at = ? AND duration_ms IS NULL",
                        (duration_ms, *key),
                    )

    @contextmanager
    def _connect(self) -> Iterator[sqlite3.Connection]:
        connection = sqlite3.connect(self._database, timeout=10)
        connection.execute("PRAGMA busy_timeout = 10000")
        try:
            yield connection
            connection.commit()
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()

    def _initialize_database(self) -> None:
        with self._connect() as connection:
            connection.execute("PRAGMA journal_mode=WAL")
            connection.execute(
                "CREATE TABLE IF NOT EXISTS plays ("
                "user_id TEXT NOT NULL, track_id TEXT NOT NULL, played_at TEXT NOT NULL, "
                "artist_ids TEXT NOT NULL, PRIMARY KEY (user_id, track_id, played_at))"
            )
            connection.execute(
                "CREATE INDEX IF NOT EXISTS idx_plays_user_date ON plays(user_id, played_at)"
            )
            columns = {row[1] for row in connection.execute("PRAGMA table_info(plays)")}
            if "duration_ms" not in columns:  # Migration für bestehende Datenbanken
                connection.execute("ALTER TABLE plays ADD COLUMN duration_ms INTEGER")

    @staticmethod
    def _discovery(
        events: list[dict[str, Any]],
        first_track_play: dict[str, datetime],
        first_artist_play: dict[str, datetime],
        start: datetime,
        end: datetime,
    ) -> dict[str, float | int | None]:
        tracks = {event["track_id"] for event in events}
        artists = {artist_id for event in events for artist_id in event["artist_ids"]}
        new_tracks = sum(start <= first_track_play[track_id] < end for track_id in tracks)
        new_artists = sum(start <= first_artist_play[artist_id] < end for artist_id in artists)
        return {
            "tracks_rate": round(new_tracks / len(tracks) * 100, 1) if tracks else None,
            "tracks_count": len(tracks),
            "tracks_discovered": new_tracks,
            "artists_rate": round(new_artists / len(artists) * 100, 1) if artists else None,
            "artists_count": len(artists),
            "artists_discovered": new_artists,
        }

    @staticmethod
    def _change(current: float | None, previous: float | None) -> float | None:
        if current is None or previous is None:
            return None
        return round(current - previous, 1)

    @staticmethod
    def _streaks(play_dates: list[Any], today: Any) -> tuple[int, int]:
        if not play_dates:
            return 0, 0

        longest = current = 1
        for previous, day in zip(play_dates, play_dates[1:]):
            if day == previous + timedelta(days=1):
                current += 1
                longest = max(longest, current)
            else:
                current = 1

        latest = play_dates[-1]
        if latest < today - timedelta(days=1):
            active = 0
        else:
            active = 1
            day = latest
            for previous in reversed(play_dates[:-1]):
                if previous == day - timedelta(days=1):
                    active += 1
                    day = previous
                else:
                    break
        return active, longest
