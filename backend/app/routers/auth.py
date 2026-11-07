"""认证路由：注册、登录、刷新轮换、登出。"""

import secrets
import uuid

import jwt
from fastapi import APIRouter, HTTPException, Request, Response, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from ..config import settings
from ..deps import CurrentUser, SessionDep
from ..models import Organization, RefreshToken, User, as_utc, utcnow
from ..schemas import AuthOut, LoginIn, RegisterIn, UserOut
from ..security import (
    create_access_token,
    create_refresh_token,
    decode_token,
    hash_password,
    verify_password,
)

router = APIRouter()

REFRESH_COOKIE_PATH = "/api/v1/auth"
CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"


def user_payload(user: User) -> dict:
    return {
        "id": user.id,
        "email": user.email,
        "display_name": user.display_name,
        "org": {"id": user.org.id, "name": user.org.name, "code": user.org.code},
    }


def auth_payload(user: User) -> dict:
    return {
        "access_token": create_access_token(user.id),
        "token_type": "bearer",
        "expires_in": settings.access_token_minutes * 60,
        "user": user_payload(user),
    }


def set_refresh_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        key=settings.refresh_cookie_name,
        value=token,
        max_age=settings.refresh_token_days * 24 * 3600,
        httponly=True,
        samesite="lax",
        secure=settings.cookie_secure,
        path=REFRESH_COOKIE_PATH,
    )


def clear_refresh_cookie(response: Response) -> None:
    response.delete_cookie(
        settings.refresh_cookie_name,
        path=REFRESH_COOKIE_PATH,
        httponly=True,
        samesite="lax",
        secure=settings.cookie_secure,
    )


async def generate_org_code(session: SessionDep) -> str:
    for _ in range(20):
        code = "".join(secrets.choice(CODE_ALPHABET) for _ in range(6))
        exists = await session.scalar(select(Organization.id).where(Organization.code == code))
        if exists is None:
            return code
    raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, "邀请码生成失败，请重试")


def issue_refresh_token(session: SessionDep, user_id: uuid.UUID) -> str:
    token, jti, expires_at = create_refresh_token(user_id)
    session.add(
        RefreshToken(jti=jti, user_id=user_id, expires_at=expires_at, created_at=utcnow())
    )
    return token


@router.post("/register", response_model=AuthOut, status_code=status.HTTP_201_CREATED)
async def register(data: RegisterIn, response: Response, session: SessionDep) -> dict:
    existing = await session.scalar(select(User.id).where(User.email == data.email))
    if existing is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "该邮箱已注册")

    if data.org_code:
        org = await session.scalar(
            select(Organization).where(Organization.code == data.org_code.upper())
        )
        if org is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "邀请码无效，请向团队管理员确认")
    else:
        org = Organization(
            name=data.org_name or f"{data.display_name}的团队",
            code=await generate_org_code(session),
        )
        session.add(org)
        await session.flush()

    user = User(
        email=data.email,
        password_hash=hash_password(data.password),
        display_name=data.display_name,
        org=org,
    )
    session.add(user)
    await session.flush()

    refresh_token = issue_refresh_token(session, user.id)
    try:
        await session.commit()
    except IntegrityError:
        await session.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "该邮箱已注册") from None

    set_refresh_cookie(response, refresh_token)
    return auth_payload(user)


@router.post("/login", response_model=AuthOut)
async def login(data: LoginIn, response: Response, session: SessionDep) -> dict:
    user = await session.scalar(select(User).where(User.email == data.email))
    if user is None or not verify_password(data.password, user.password_hash):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "邮箱或密码不正确")

    refresh_token = issue_refresh_token(session, user.id)
    await session.commit()
    set_refresh_cookie(response, refresh_token)
    return auth_payload(user)


@router.post("/refresh", response_model=AuthOut)
async def refresh(request: Request, response: Response, session: SessionDep) -> dict:
    token = request.cookies.get(settings.refresh_cookie_name)
    if not token:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "登录状态已失效，请重新登录")
    try:
        payload = decode_token(token, "refresh")
        jti = uuid.UUID(payload["jti"])
        user_id = uuid.UUID(payload["sub"])
    except (jwt.InvalidTokenError, KeyError, ValueError):
        clear_refresh_cookie(response)
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "登录状态已失效，请重新登录") from None

    record = await session.get(RefreshToken, jti)
    now = utcnow()
    if (
        record is None
        or record.revoked_at is not None
        or as_utc(record.expires_at) <= now
        or record.user_id != user_id
    ):
        clear_refresh_cookie(response)
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "登录状态已失效，请重新登录")

    user = await session.get(User, user_id)
    if user is None:
        clear_refresh_cookie(response)
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "用户不存在")

    # 轮换：旧 refresh 立即失效，新 refresh 写回 httpOnly cookie
    record.revoked_at = now
    new_token, new_jti, new_expires = create_refresh_token(user.id)
    record.replaced_by = new_jti
    session.add(
        RefreshToken(
            jti=new_jti,
            user_id=user.id,
            expires_at=new_expires,
            created_at=now,
        )
    )
    await session.commit()

    set_refresh_cookie(response, new_token)
    return auth_payload(user)


@router.post("/logout")
async def logout(request: Request, response: Response, session: SessionDep) -> dict:
    token = request.cookies.get(settings.refresh_cookie_name)
    if token:
        try:
            payload = decode_token(token, "refresh")
            record = await session.get(RefreshToken, uuid.UUID(payload["jti"]))
            if record is not None and record.revoked_at is None:
                record.revoked_at = utcnow()
                await session.commit()
        except (jwt.InvalidTokenError, KeyError, ValueError):
            pass
    clear_refresh_cookie(response)
    return {"ok": True}


@router.get("/me", response_model=UserOut)
async def me(user: CurrentUser) -> dict:
    return user_payload(user)
