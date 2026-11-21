from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from app.exceptions import (
    InvalidRequestError,
    MissingPlaylistScopeError,
    NotAuthenticatedError,
    SpotifyApiError,
    SpotifyUnavailableError,
)


def register_exception_handlers(app: FastAPI) -> None:
    @app.exception_handler(NotAuthenticatedError)
    async def not_authenticated(request: Request, exc: NotAuthenticatedError):
        return JSONResponse(
            status_code=401,
            content={"detail": "nicht eingeloggt, bitte /login aufrufen"},
        )

    @app.exception_handler(SpotifyApiError)
    async def spotify_api_error(request: Request, exc: SpotifyApiError):
        return JSONResponse(
            status_code=exc.status_code,
            content={"detail": f"spotify-fehler: {exc.message}"},
        )

    @app.exception_handler(SpotifyUnavailableError)
    async def spotify_unavailable(request: Request, exc: SpotifyUnavailableError):
        return JSONResponse(
            status_code=502,
            content={"detail": "spotify nicht erreichbar"},
        )

    @app.exception_handler(MissingPlaylistScopeError)
    async def missing_playlist_scope(request: Request, exc: MissingPlaylistScopeError):
        return JSONResponse(
            status_code=403,
            content={
                "detail": (
                    "Für Playlist-Vorschläge fehlt die Spotify-Berechtigung. "
                    "Bitte abmelden und erneut anmelden."
                )
            },
        )

    @app.exception_handler(InvalidRequestError)
    async def invalid_request(request: Request, exc: InvalidRequestError):
        return JSONResponse(status_code=400, content={"detail": str(exc)})
