"""后台任务：进程内 APScheduler 逾期扫描（不依赖 Redis / Celery）。"""

from datetime import datetime, timedelta, timezone

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from sqlalchemy import select

from ..config import settings
from ..db import SessionLocal
from ..models import OPEN_STATUSES, Notification, Todo, as_utc, utcnow
from .notifications import notify

scheduler = AsyncIOScheduler(timezone="UTC")


async def scan_overdue_todos() -> int:
    """扫描逾期未完成的待办，给负责人发一条站内通知（每个待办每天最多一次）。"""
    now = utcnow()
    created = 0
    async with SessionLocal() as session:
        todos = await session.scalars(
            select(Todo).where(
                Todo.status.in_(OPEN_STATUSES),
                Todo.due_date.is_not(None),
                Todo.due_date < now,
            )
        )
        for todo in todos:
            dedupe_key = f"overdue:{todo.id}:{now.date().isoformat()}"
            exists = await session.scalar(
                select(Notification.id).where(Notification.dedupe_key == dedupe_key)
            )
            if exists is not None:
                continue
            due = as_utc(todo.due_date)
            due_text = due.astimezone().strftime("%m月%d日 %H:%M") if due else ""
            notify(
                session,
                todo.assignee_id,
                todo.id,
                "todo_overdue",
                "待办已逾期",
                f"「{todo.title}」原定 {due_text} 前完成，请尽快处理。",
                dedupe_key=dedupe_key,
                created_at=now,
            )
            created += 1
        if created:
            await session.commit()
    return created


def start_scheduler() -> None:
    scheduler.add_job(
        scan_overdue_todos,
        "interval",
        minutes=settings.overdue_scan_minutes,
        id="overdue-scan",
        replace_existing=True,
        coalesce=True,
        max_instances=1,
        misfire_grace_time=120,
        next_run_time=datetime.now(timezone.utc) + timedelta(seconds=8),
    )
    scheduler.start()


def stop_scheduler() -> None:
    if scheduler.running:
        scheduler.shutdown(wait=False)
