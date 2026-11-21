"""Verdrahtung der Services (Dependency Injection) und Authentifizierung per Session-Cookie.
lru_cache macht die Services zu Singletons, wichtig, weil der AuthService die Sessions im Speicher hält."""
from functools import lru_cache
from typing import Annotated

from fastapi import Cookie, Depends

from app.clients.spotify_client import SpotifyClient
from app.config import Settings, get_settings
from app.services.auth_service import AuthService
from app.services.audio_analysis_service import AudioAnalysisService
from app.services.playlist_service import PlaylistService
from app.services.recommender_service import RecommenderService
from app.services.stats_service import StatsService
from app.services.track_service import TrackService
from app.services.user_service import UserService

SESSION_COOKIE = "session_id"


@lru_cache
def get_spotify_client() -> SpotifyClient:
    settings = get_settings()
    return SpotifyClient(settings.spotify_client_id, settings.spotify_client_secret)


@lru_cache
def get_auth_service() -> AuthService:
    return AuthService(get_settings(), get_spotify_client())


@lru_cache
def get_stats_service() -> StatsService:
    return StatsService(get_spotify_client())


@lru_cache
def get_user_service() -> UserService:
    return UserService(get_spotify_client())


@lru_cache
def get_audio_analysis_service() -> AudioAnalysisService:
    return AudioAnalysisService()


@lru_cache
def get_track_service() -> TrackService:
    return TrackService(get_spotify_client())


@lru_cache
def get_playlist_service() -> PlaylistService:
    return PlaylistService(get_spotify_client())


@lru_cache
def get_recommender_service() -> RecommenderService:
    return RecommenderService(get_spotify_client(), get_playlist_service())


def get_session_id(
    session_id: Annotated[str | None, Cookie(alias=SESSION_COOKIE, include_in_schema=False)] = None,
) -> str | None:
    return session_id


def get_access_token(
    auth: Annotated[AuthService, Depends(get_auth_service)],
    session_id: Annotated[str | None, Depends(get_session_id)],
) -> str:
    """Löst das Session-Cookie in einen gültigen Spotify-Token auf.
    Ohne gültige Session wird NotAuthenticatedError geworfen (-> 401)."""
    return auth.get_user_token(session_id)


SettingsDep = Annotated[Settings, Depends(get_settings)]
AuthServiceDep = Annotated[AuthService, Depends(get_auth_service)]
StatsServiceDep = Annotated[StatsService, Depends(get_stats_service)]
UserServiceDep = Annotated[UserService, Depends(get_user_service)]
TrackServiceDep = Annotated[TrackService, Depends(get_track_service)]
AudioAnalysisServiceDep = Annotated[AudioAnalysisService, Depends(get_audio_analysis_service)]
PlaylistServiceDep = Annotated[PlaylistService, Depends(get_playlist_service)]
RecommenderServiceDep = Annotated[RecommenderService, Depends(get_recommender_service)]
SessionIdDep = Annotated[str | None, Depends(get_session_id)]
AccessTokenDep = Annotated[str, Depends(get_access_token)]
