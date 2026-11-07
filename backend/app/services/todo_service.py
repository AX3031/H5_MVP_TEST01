"""服务层：待办查询、创建、状态流转（含权限、审计、通知）。"""

import uuid
from typing import Literal

from fastapi import HTTPException, status as http_status
from sqlalchemy import case, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from transitions import MachineError

from ..domain.rules import STATUS_ACTIONS, STATUS_LABELS, available_actions
from ..domain.todo_fsm import TodoFSM
from ..models import TODO_STATUSES, Todo, TodoTransition, User, utcnow
from ..schemas import TodoCreateIn, TransitionIn
from ..serializers import person
from .notifications import notify

DEFAULT_LIMIT = 100


def _conflict(message: str) -> HTTPException:
    return HTTPException(http_status.HTTP_409_CONFLICT, message)


async def get_org_member(session: AsyncSession, user_id: uuid.UUID, org_id: uuid.UUID) -> User:
    member = await session.scalar(select(User).where(User.id == user_id, User.org_id == org_id))
    if member is None:
        raise HTTPException(http_status.HTTP_422_UNPROCESSABLE_ENTITY, "负责人必须是同一团队的成员")
    return member


async def get_todo(
    session: AsyncSession,
    todo_id: uuid.UUID,
    user: User,
    *,
    for_update: bool = False,
) -> Todo:
    stmt = (
        select(Todo)
        .where(Todo.id == todo_id, Todo.org_id == user.org_id)
        .options(selectinload(Todo.assignee), selectinload(Todo.creator))
    )
    if for_update:
        stmt = stmt.with_for_update()
    todo = await session.scalar(stmt)
    if todo is None:
        raise HTTPException(http_status.HTTP_404_NOT_FOUND, "待办不存在或无权访问")
    return todo


async def get_history(session: AsyncSession, todo_id: uuid.UUID) -> list[TodoTransition]:
    rows = await session.scalars(
        select(TodoTransition)
        .where(TodoTransition.todo_id == todo_id)
        .order_by(TodoTransition.id.asc())
    )
    return list(rows)


async def list_todos(
    session: AsyncSession,
    user: User,
    scope: Literal["mine", "created", "all"],
    status_filter: str | None = None,
) -> dict:
    conditions = [Todo.org_id == user.org_id]
    if scope == "mine":
        conditions.append(Todo.assignee_id == user.id)
    elif scope == "created":
        conditions.append(Todo.creator_id == user.id)

    count_rows = await session.execute(
        select(Todo.status, func.count(Todo.id)).where(*conditions).group_by(Todo.status)
    )
    counts = {status: 0 for status in TODO_STATUSES}
    for status_value, amount in count_rows.all():
        counts[status_value] = amount
    counts["all"] = sum(counts[status] for status in TODO_STATUSES)

    stmt = (
        select(Todo)
        .where(*conditions)
        .options(selectinload(Todo.assignee), selectinload(Todo.creator))
    )
    if status_filter:
        stmt = stmt.where(Todo.status == status_filter)

    status_order = case(
        (Todo.status == "in_progress", 0),
        (Todo.status == "pending", 1),
        (Todo.status == "completed", 2),
        (Todo.status == "rejected", 3),
        else_=4,
    )
    stmt = stmt.order_by(
        status_order,
        Todo.due_date.is_(None),
        Todo.due_date.asc(),
        Todo.updated_at.desc(),
    ).limit(DEFAULT_LIMIT)

    items = list(await session.scalars(stmt))
    return {"items": items, "counts": counts, "total": counts["all"], "scope": scope}


async def create_todo(session: AsyncSession, creator: User, data: TodoCreateIn) -> Todo:
    assignee = await get_org_member(session, data.assignee_id, creator.org_id)
    now = utcnow()
    todo = Todo(
        org_id=creator.org_id,
        title=data.title,
        description=data.description,
        status="pending",
        assignee=assignee,
        creator=creator,
        due_date=data.due_date,
        created_at=now,
        updated_at=now,
    )
    session.add(todo)
    await session.flush()

    session.add(
        TodoTransition(
            todo_id=todo.id,
            from_status=None,
            to_status="pending",
            action="create",
            operator_id=creator.id,
            meta={"assignee": person(assignee)},
            created_at=now,
        )
    )
    if assignee.id != creator.id:
        notify(
            session,
            assignee.id,
            todo.id,
            "todo_created",
            "你收到一个新待办",
            f"{creator.display_name} 指派给你：{todo.title}",
            created_at=now,
        )
    await session.commit()
    return todo


async def transition_todo(
    session: AsyncSession, todo: Todo, user: User, data: TransitionIn
) -> Todo:
    action = data.action

    # 1. 状态维度校验（服务端强制，不依赖前端按钮）
    if action not in STATUS_ACTIONS.get(todo.status, set()):
        label = STATUS_LABELS.get(todo.status, todo.status)
        raise _conflict(f"当前状态为「{label}」，不允许执行该操作")

    # 2. 角色维度校验（唯一真相源）
    if action not in available_actions(todo, user):
        raise HTTPException(http_status.HTTP_403_FORBIDDEN, "你没有权限执行该操作")

    # 3. 必填字段校验
    reason = (data.reject_reason or "").strip()
    new_assignee: User | None = None
    if action == "reject" and not reason:
        raise HTTPException(http_status.HTTP_422_UNPROCESSABLE_ENTITY, "请填写驳回原因")
    if action == "transfer":
        if data.new_assignee_id is None:
            raise HTTPException(http_status.HTTP_422_UNPROCESSABLE_ENTITY, "请选择转交对象")
        if data.new_assignee_id == todo.assignee_id:
            raise HTTPException(http_status.HTTP_422_UNPROCESSABLE_ENTITY, "不能转交给当前负责人")
        new_assignee = await get_org_member(session, data.new_assignee_id, user.org_id)

    # 4. 状态机校验（transitions）
    try:
        new_status = TodoFSM(todo.status).apply(action)
    except MachineError:
        raise _conflict("非法的状态流转") from None

    now = utcnow()
    previous_status = todo.status
    meta: dict = {}

    if action == "assign":
        todo.reject_reason = None
    elif action == "reject":
        todo.reject_reason = reason
        meta = {"reason": reason}
    elif action == "transfer":
        assert new_assignee is not None
        meta = {
            "from_assignee": person(todo.assignee),
            "to_assignee": person(new_assignee),
        }
        todo.assignee = new_assignee
        todo.assignee_id = new_assignee.id
        todo.reject_reason = None

    todo.status = new_status
    todo.updated_at = now

    session.add(
        TodoTransition(
            todo_id=todo.id,
            from_status=previous_status,
            to_status=new_status,
            action=action,
            operator_id=user.id,
            meta=meta,
            created_at=now,
        )
    )

    _notify_counterparts(session, todo, user, action, reason, new_assignee, now)
    await session.commit()
    return todo


def _notify_counterparts(
    session: AsyncSession,
    todo: Todo,
    actor: User,
    action: str,
    reason: str,
    new_assignee: User | None,
    now,
) -> None:
    creator_id = todo.creator_id
    if action == "assign" and creator_id != actor.id:
        notify(
            session,
            creator_id,
            todo.id,
            "todo_assigned",
            "待办已开始处理",
            f"{actor.display_name} 开始处理「{todo.title}」",
            created_at=now,
        )
    elif action == "complete" and creator_id != actor.id:
        notify(
            session,
            creator_id,
            todo.id,
            "todo_completed",
            "待办已完成",
            f"{actor.display_name} 完成了「{todo.title}」",
            created_at=now,
        )
    elif action == "reject" and creator_id != actor.id:
        notify(
            session,
            creator_id,
            todo.id,
            "todo_rejected",
            "待办被驳回",
            f"{actor.display_name} 驳回了「{todo.title}」：{reason}",
            created_at=now,
        )
    elif action == "transfer" and new_assignee is not None:
        recipients = {
            new_assignee.id: (
                "有一个待办转交给你",
                f"{actor.display_name} 将「{todo.title}」转交给你",
            ),
            creator_id: (
                "待办已转交",
                f"{actor.display_name} 将「{todo.title}」转交给 {new_assignee.display_name}",
            ),
        }
        recipients.pop(actor.id, None)
        for user_id, (title, body) in recipients.items():
            notify(
                session,
                user_id,
                todo.id,
                "todo_transferred",
                title,
                body,
                created_at=now,
            )
