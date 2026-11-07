"""待办路由：创建、列表、详情、统一流转入口。"""

import uuid

from fastapi import APIRouter, Query, status

from ..deps import CurrentUser, SessionDep
from ..schemas import (
    Scope,
    TodoCreateIn,
    TodoDetailOut,
    TodoListOut,
    TodoStatus,
    TransitionIn,
)
from ..serializers import todo_detail, todo_summary
from ..services import todo_service

router = APIRouter()


@router.post("", response_model=TodoDetailOut, status_code=status.HTTP_201_CREATED)
async def create_todo(
    data: TodoCreateIn, user: CurrentUser, session: SessionDep
) -> dict:
    todo = await todo_service.create_todo(session, user, data)
    history = await todo_service.get_history(session, todo.id)
    return todo_detail(todo, user, history)


@router.get("", response_model=TodoListOut)
async def list_todos(
    user: CurrentUser,
    session: SessionDep,
    scope: Scope = Query("mine"),
    status_filter: TodoStatus | None = Query(None, alias="status"),
) -> dict:
    result = await todo_service.list_todos(session, user, scope, status_filter)
    return {
        "items": [todo_summary(todo) for todo in result["items"]],
        "counts": result["counts"],
        "total": result["total"],
        "scope": result["scope"],
    }


@router.get("/{todo_id}", response_model=TodoDetailOut)
async def get_todo(
    todo_id: uuid.UUID, user: CurrentUser, session: SessionDep
) -> dict:
    todo = await todo_service.get_todo(session, todo_id, user)
    history = await todo_service.get_history(session, todo.id)
    return todo_detail(todo, user, history)


@router.post("/{todo_id}/transition", response_model=TodoDetailOut)
async def transition(
    todo_id: uuid.UUID, data: TransitionIn, user: CurrentUser, session: SessionDep
) -> dict:
    todo = await todo_service.get_todo(session, todo_id, user, for_update=True)
    await todo_service.transition_todo(session, todo, user, data)
    history = await todo_service.get_history(session, todo.id)
    return todo_detail(todo, user, history)
