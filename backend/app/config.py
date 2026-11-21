import os
from dataclasses import dataclass
from functools import lru_cache


@dataclass(frozen=True)
class Settings:
    spotify_client_id: str
    spotify_client_secret: str
    spotify_redirect_uri: str
    frontend_url: str
    cookie_secure: bool


@lru_cache
def get_settings() -> Settings:
    return Settings(
        spotify_client_id=os.environ["SPOTIFY_CLIENT_ID"],
        spotify_client_secret=os.environ["SPOTIFY_CLIENT_SECRET"],
        spotify_redirect_uri=os.getenv(
            "SPOTIFY_REDIRECT_URI", "http://127.0.0.1:8000/callback"
        ),
        # hierhin geht es nach dem spotify-login zurück
        frontend_url=os.getenv("FRONTEND_URL", "http://127.0.0.1:4200").rstrip("/"),
        # hinter https auf "true" setzen, damit der session-cookie nur dort gesendet wird
        cookie_secure=os.getenv("COOKIE_SECURE", "false").lower() == "true",
    )
