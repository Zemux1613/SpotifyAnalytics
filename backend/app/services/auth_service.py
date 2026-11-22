import logging
import secrets
import threading
import time
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlencode

from app.clients.spotify_client import SpotifyClient
from app.config import Settings
from app.exceptions import NotAuthenticatedError, SpotifyApiError

logger = logging.getLogger(__name__)

AUTH_URL = "https://accounts.spotify.com/authorize"
SCOPES = (
    "user-top-read "
    "user-read-recently-played "
    "user-read-playback-state "
    "user-read-currently-playing "
    "playlist-read-private "
    "playlist-read-collaborative "
    "playlist-modify-public "
    "playlist-modify-private"
)
EXPIRY_MARGIN = 30  # sekunden, token lieber etwas früher erneuern


@dataclass
class _Token:
    access_token: str | None = None
    refresh_token: str | None = None
    expires_at: float = 0.0

    @property
    def is_valid(self) -> bool:
        return self.access_token is not None and time.time() < self.expires_at - EXPIRY_MARGIN

    def update(self, data: dict[str, Any]) -> None:
        self.access_token = data["access_token"]
        self.expires_at = time.time() + data["expires_in"]
        # beim refresh liefert spotify nicht immer einen neuen refresh_token mit
        if "refresh_token" in data:
            self.refresh_token = data["refresh_token"]


class AuthService:
    """Verwaltet die Sessions der eingeloggten User und deren Spotify-Token.

    Eine Session-ID (zufälliger String) steht im Cookie des Browsers, die Spotify-Token
    bleiben auf dem Server. Alles liegt nur im Speicher und ist nach einem Neustart weg.
    Zusätzlich gibt es einen App-Token (client credentials) für Daten ohne User-Bezug."""

    def __init__(self, settings: Settings, client: SpotifyClient):
        self._settings = settings
        self._client = client
        self._sessions: dict[str, _Token] = {}
        self._app = _Token()
        # sync-endpoints laufen im threadpool, Token-Zugriffe und Refresh sollen nicht kollidieren
        self._lock = threading.Lock()

    def build_authorize_url(self) -> str:
        params = {
            "client_id": self._settings.spotify_client_id,
            "response_type": "code",
            "redirect_uri": self._settings.spotify_redirect_uri,
            "scope": SCOPES,
        }
        return f"{AUTH_URL}?{urlencode(params)}"

    def login(self, code: str) -> str:
        """Tauscht den code gegen Token und legt eine neue Session an. Gibt die Session-ID zurück."""
        data = self._client.request_token(
            grant_type="authorization_code",
            code=code,
            redirect_uri=self._settings.spotify_redirect_uri,
        )
        token = _Token()
        token.update(data)
        session_id = secrets.token_urlsafe(32)
        with self._lock:
            self._sessions[session_id] = token
        return session_id

    def logout(self, session_id: str | None) -> None:
        if session_id is None:
            return
        with self._lock:
            self._sessions.pop(session_id, None)

    def get_user_token(self, session_id: str | None) -> str:
        with self._lock:
            token = self._sessions.get(session_id) if session_id else None
            if token is None:
                raise NotAuthenticatedError()
            if not token.is_valid:
                self._refresh(session_id, token)
            return token.access_token

    def get_app_token(self) -> str:
        with self._lock:
            if not self._app.is_valid:
                data = self._client.request_token(grant_type="client_credentials")
                self._app.update(data)
            return self._app.access_token

    def _refresh(self, session_id: str, token: _Token) -> None:
        """Muss mit gehaltenem Lock aufgerufen werden."""
        if token.refresh_token is None:
            self._sessions.pop(session_id, None)
            raise NotAuthenticatedError()
        try:
            data = self._client.request_token(
                grant_type="refresh_token", refresh_token=token.refresh_token
            )
        except SpotifyApiError as e:
            if e.status_code in (400, 401):  # refresh-token widerrufen oder ungültig
                logger.info("refresh fehlgeschlagen, session wird beendet: %s", e.message)
                self._sessions.pop(session_id, None)
                raise NotAuthenticatedError() from e
            raise
        token.update(data)
