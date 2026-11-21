from fastapi import FastAPI

from app.api.error_handlers import register_exception_handlers
from app.api.routes import auth, health, me, playlists, tracks
from app.config import get_settings
from app.logging_config import setup_logging


def create_app() -> FastAPI:
    setup_logging()
    get_settings()  # fail fast: fehlende env-variablen sofort beim start melden

    app = FastAPI(title="Spotify Analytics")
    register_exception_handlers(app)
    app.include_router(health.router)
    app.include_router(auth.router)
    app.include_router(me.router)
    app.include_router(playlists.router)
    app.include_router(tracks.router)
    return app


app = create_app()
