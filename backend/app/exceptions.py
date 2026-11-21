"""Fachliche Fehler. Die Services werfen nur diese, nie HTTPException.
Die Übersetzung in HTTP-Statuscodes passiert im REST-Layer (api/error_handlers.py)."""


class NotAuthenticatedError(Exception):
    """Es gibt (noch) keinen gültigen User-Token, /login wurde nicht durchlaufen."""


class SpotifyApiError(Exception):
    """Spotify hat mit einem Fehlerstatus geantwortet."""

    def __init__(self, status_code: int, message: str):
        super().__init__(f"{status_code}: {message}")
        self.status_code = status_code
        self.message = message


class SpotifyUnavailableError(Exception):
    """Spotify war nicht erreichbar (Timeout, DNS, Verbindungsfehler)."""


class MissingPlaylistScopeError(Exception):
    """Dem Token fehlen die Playlist-Berechtigungen (nach Scope-Änderung neu einloggen)."""


class InvalidRequestError(Exception):
    """Die Anfrage des Clients ist fachlich ungültig."""
