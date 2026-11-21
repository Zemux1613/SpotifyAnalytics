import logging
import time
from typing import Any

import requests

from app.exceptions import SpotifyApiError, SpotifyUnavailableError

logger = logging.getLogger(__name__)

TOKEN_URL = "https://accounts.spotify.com/api/token"
API_BASE = "https://api.spotify.com/v1"
TIMEOUT = 10


class SpotifyClient:
    """Dünner HTTP-Client. Kennt weder Token-Verwaltung noch Fachlogik."""

    def __init__(self, client_id: str, client_secret: str):
        self._client_id = client_id
        self._client_secret = client_secret

    def request_token(self, **form: str) -> dict[str, Any]:
        """POST an den Token-Endpoint (Basic Auth mit client id + secret)."""
        resp = self._send(
            "POST",
            TOKEN_URL,
            data=form,
            auth=(self._client_id, self._client_secret),
        )
        return resp.json()

    def get(self, endpoint: str, access_token: str, **params: Any) -> dict[str, Any]:
        resp = self._send(
            "GET",
            f"{API_BASE}{endpoint}",
            headers={"Authorization": f"Bearer {access_token}"},
            params=params,
        )
        return resp.json()

    def post(
        self, endpoint: str, access_token: str, payload: dict[str, Any]
    ) -> dict[str, Any]:
        resp = self._send(
            "POST",
            f"{API_BASE}{endpoint}",
            headers={"Authorization": f"Bearer {access_token}"},
            json=payload,
        )
        # manche POST-Endpunkte antworten mit 204 ohne Body
        return resp.json() if resp.content else {}

    def _send(self, method: str, url: str, **kwargs: Any) -> requests.Response:
        start = time.perf_counter()
        try:
            resp = requests.request(method, url, timeout=TIMEOUT, **kwargs)
        except requests.RequestException as e:
            logger.error("spotify %s %s nicht erreichbar: %s", method, url, e)
            raise SpotifyUnavailableError() from e

        ms = (time.perf_counter() - start) * 1000
        # nur params loggen, nie data/headers (enthalten code, refresh-token, bearer)
        logger.debug(
            "spotify %s %s params=%s -> %d (%.0f ms)",
            method, url, kwargs.get("params"), resp.status_code, ms,
        )

        if not resp.ok:
            message = _extract_message(resp)
            logger.warning("spotify %s %s fehlgeschlagen: %d %s", method, url, resp.status_code, message)
            raise SpotifyApiError(resp.status_code, message)
        return resp


def _extract_message(resp: requests.Response) -> str:
    try:
        body = resp.json()
    except ValueError:
        return resp.text[:200] or "unbekannter fehler"
    if not isinstance(body, dict):
        return "unbekannter fehler"
    error = body.get("error")
    if isinstance(error, dict):  # api: {"error": {"status": 401, "message": "..."}}
        return error.get("message", "unbekannter fehler")
    # token-endpoint: {"error": "invalid_grant", "error_description": "..."}
    return body.get("error_description") or error or "unbekannter fehler"
