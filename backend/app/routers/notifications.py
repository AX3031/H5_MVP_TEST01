"""站内通知路由：列表、未读数、已读。"""

from fastapi import APIRouter, HTTPException, Query, status
from sqlalchemy import func, select

from ..deps import CurrentUser, SessionDep
from ..models import Notification, utcnow
from ..schemas import CountOut, NotificationListOut
from ..serializers import notification_out

router = APIRouter()


async def _unread_count(session: SessionDep, user_id) -> int:
    return (
        await session.scalar(
            select(func.count(Notification.id)).where(
                Notification.user_id == user_id, Notification.read_at.is_(None)
            )
        )
        or 0
    )


@router.get("", response_model=NotificationListOut)
async def list_notifications(
    user: CurrentUser,
    session: SessionDep,
    limit: int = Query(30, ge=1, le=100),
) -> dict:
    rows = await session.scalars(
        select(Notification)
        .where(Notification.user_id == user.id)
        .order_by(Notification.created_at.desc(), Notification.id.desc())
        .limit(limit)
    )
    return {
        "items": [notification_out(item) for item in rows],
        "unread": await _unread_count(session, user.id),
    }


@router.get("/unread-count", response_model=CountOut)
async def unread_count(user: CurrentUser, session: SessionDep) -> dict:
    return {"unread": await _unread_count(session, user.id)}


@router.post("/read-all", response_model=CountOut)
async def read_all(user: CurrentUser, session: SessionDep) -> dict:
    rows = await session.scalars(
        select(Notification).where(
            Notification.user_id == user.id, Notification.read_at.is_(None)
        )
    )
    now = utcnow()
    for item in rows:
        item.read_at = now
    await session.commit()
    return {"unread": 0}


@router.post("/{notification_id}/read", response_model=CountOut)
async def mark_read(
    notification_id: int, user: CurrentUser, session: SessionDep
) -> dict:
    item = await session.scalar(
        select(Notification).where(
            Notification.id == notification_id, Notification.user_id == user.id
        )
    )
    if item is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "通知不存在")
    if item.read_at is None:
        item.read_at = utcnow()
        await session.commit()
    return {"unread": await _unread_count(session, user.id)}
