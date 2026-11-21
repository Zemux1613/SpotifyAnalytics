import logging

from fastapi import APIRouter
from fastapi.responses import JSONResponse, RedirectResponse

from app.api.deps import SESSION_COOKIE, AuthServiceDep, SessionIdDep, SettingsDep
from app.api.schemas import LogoutResponse
from app.exceptions import SpotifyApiError, SpotifyUnavailableError

logger = logging.getLogger(__name__)

router = APIRouter(tags=["auth"])


@router.get("/login", include_in_schema=False)
def login(auth: AuthServiceDep):
    return RedirectResponse(auth.build_authorize_url())


@router.get("/callback", include_in_schema=False)
def callback(
    auth: AuthServiceDep,
    settings: SettingsDep,
    code: str | None = None,
    error: str | None = None,
):
    """Spotify leitet den Browser hierher zurück. Es wird eine Session angelegt
    und der Browser zurück zum Frontend geschickt."""
    if error or not code:
        return RedirectResponse(
            f"{settings.frontend_url}/login?error={error or 'missing_code'}",
            status_code=302,
        )
    try:
        session_id = auth.login(code)
    except (SpotifyApiError, SpotifyUnavailableError) as e:
        logger.warning("login fehlgeschlagen: %s", e)
        return RedirectResponse(
            f"{settings.frontend_url}/login?error=login_failed", status_code=302
        )

    response = RedirectResponse(settings.frontend_url, status_code=302)
    response.set_cookie(
        SESSION_COOKIE,
        session_id,
        httponly=True,  # für javascript nicht lesbar
        samesite="lax",
        secure=settings.cookie_secure,
        path="/",
        # ohne max_age: Session-Cookie, gilt bis der Browser geschlossen wird
    )
    return response


@router.post("/logout", response_model=LogoutResponse)
def logout(auth: AuthServiceDep, session_id: SessionIdDep):
    auth.logout(session_id)
    response = JSONResponse(LogoutResponse(status="ausgeloggt").model_dump())
    response.delete_cookie(SESSION_COOKIE, path="/")
    return response
