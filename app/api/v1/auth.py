from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.database import get_session
from app.models import User
from app.models.base import utcnow
from app.schemas.auth import LoginRequest
from app.schemas.common import ErrorResponse
from app.schemas.invites import AcceptInviteRequest
from app.schemas.users import UserRead
from app.security_passwords import verify_password
from app.services import invites as invites_service
from app.services import login_rate_limit
from app.services import sessions as sessions_service

# Registered directly on the app in app/main.py, NOT through `api_router` --
# every route here must be reachable without a *prior* valid credential (there
# is no session or API key yet at invite-accept/login time; logout/me need to
# resolve whatever session cookie is presented, which isn't the api_router's
# X-API-Key gate). This session-cookie resolution is local to this router for
# now; slice 3 folds it into app/security.py's AuthContext so other REST
# routes can accept a session cookie too.
router = APIRouter(prefix="/auth", tags=["auth"])

_LOGIN_FAILURE_DETAIL = "Invalid email or password"


@router.post(
    "/invites/accept",
    operation_id="accept_invite",
    summary="Accept an invite",
    description="Creates the account for a valid, unused, unexpired invite token and sets its password.",
    response_model=UserRead,
    status_code=status.HTTP_201_CREATED,
    responses={
        404: {"model": ErrorResponse, "description": "Invite not found"},
        409: {"model": ErrorResponse, "description": "Invite already used, revoked, or expired"},
    },
)
async def accept_invite(
    data: AcceptInviteRequest, session: AsyncSession = Depends(get_session)
) -> UserRead:
    user = await invites_service.accept_invite(session, data)
    return UserRead.model_validate(user)


def _client_ip(request: Request) -> str:
    return request.client.host if request.client else "unknown"


def _set_session_cookie(
    response: Response, request: Request, raw_token: str, expires_at: datetime
) -> None:
    settings = get_settings()
    max_age = max(0, int((expires_at - utcnow()).total_seconds()))
    response.set_cookie(
        key=settings.SESSION_COOKIE_NAME,
        value=raw_token,
        max_age=max_age,
        httponly=True,
        samesite="lax",
        secure=request.url.scheme == "https",
        path="/",
    )


def _clear_session_cookie(response: Response, request: Request) -> None:
    settings = get_settings()
    response.delete_cookie(
        key=settings.SESSION_COOKIE_NAME,
        httponly=True,
        samesite="lax",
        secure=request.url.scheme == "https",
        path="/",
    )


async def require_session_user(
    request: Request, session: AsyncSession = Depends(get_session)
) -> User:
    raw_token = request.cookies.get(get_settings().SESSION_COOKIE_NAME)
    if raw_token:
        user = await sessions_service.resolve_session(session, raw_token)
        if user is not None:
            return user
    raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")


@router.post(
    "/login",
    operation_id="login",
    summary="Log in",
    description=(
        "Verifies email + password (Argon2id) and starts a server-side session, delivered as an "
        "HttpOnly, SameSite=Lax cookie (Secure over HTTPS). Rate-limited per email and per IP."
    ),
    response_model=UserRead,
    responses={
        401: {"model": ErrorResponse, "description": "Invalid email or password"},
        429: {"model": ErrorResponse, "description": "Too many login attempts"},
    },
)
async def login(
    data: LoginRequest,
    request: Request,
    response: Response,
    session: AsyncSession = Depends(get_session),
) -> UserRead:
    email = data.email.strip().lower()
    ip_address = _client_ip(request)

    await login_rate_limit.check_rate_limit(session, email, ip_address)

    result = await session.execute(select(User).where(User.email == email))
    user = result.scalar_one_or_none()

    valid = (
        user is not None
        and user.disabled_at is None
        and verify_password(data.password, user.password_hash)
    )
    if not valid:
        await login_rate_limit.record_attempt(session, email, ip_address, succeeded=False)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=_LOGIN_FAILURE_DETAIL)

    assert user is not None  # narrowed by `valid` above
    await login_rate_limit.record_attempt(session, email, ip_address, succeeded=True)
    user_session, raw_token = await sessions_service.create_session(
        session, user, user_agent=request.headers.get("user-agent"), ip_address=ip_address
    )
    _set_session_cookie(response, request, raw_token, user_session.expires_at)
    return UserRead.model_validate(user)


@router.post(
    "/logout",
    operation_id="logout",
    summary="Log out",
    description="Revokes the current session server-side and clears the session cookie.",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def logout(
    request: Request, response: Response, session: AsyncSession = Depends(get_session)
) -> None:
    raw_token = request.cookies.get(get_settings().SESSION_COOKIE_NAME)
    if raw_token:
        await sessions_service.revoke_session(session, raw_token)
    _clear_session_cookie(response, request)


@router.get(
    "/me",
    operation_id="get_current_user",
    summary="Get the current session's user",
    response_model=UserRead,
    responses={401: {"model": ErrorResponse, "description": "Not authenticated"}},
)
async def me(user: User = Depends(require_session_user)) -> UserRead:
    return UserRead.model_validate(user)
