"""站内通知写入（同一事务内，不单独提交）。"""

import uuid
from datetime import datetime

from sqlalchemy.ext.asyncio import AsyncSession

from ..models import Notification, utcnow


def notify(
    session: AsyncSession,
    user_id: uuid.UUID,
    todo_id: uuid.UUID | None,
    notif_type: str,
    title: str,
    body: str | None = None,
    dedupe_key: str | None = None,
    created_at: datetime | None = None,
) -> Notification:
    item = Notification(
        user_id=user_id,
        todo_id=todo_id,
        type=notif_type,
        title=title,
        body=body,
        dedupe_key=dedupe_key,
        created_at=created_at or utcnow(),
    )
    session.add(item)
    return item
