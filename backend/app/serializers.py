"""模型到 API 响应的序列化。"""

from .models import OPEN_STATUSES, Notification, Todo, TodoTransition, User, as_utc, utcnow
from .domain.rules import available_actions


def person(user: User) -> dict:
    # id 转字符串：既可用于响应，也可直接写入 todo_transitions.meta(JSON)
    return {"id": str(user.id), "display_name": user.display_name}


def is_overdue(todo: Todo) -> bool:
    due = as_utc(todo.due_date)
    return bool(due and todo.status in OPEN_STATUSES and due < utcnow())


def todo_summary(todo: Todo) -> dict:
    return {
        "id": todo.id,
        "title": todo.title,
        "description": todo.description,
        "status": todo.status,
        "assignee": person(todo.assignee),
        "creator": person(todo.creator),
        "due_date": as_utc(todo.due_date),
        "reject_reason": todo.reject_reason,
        "created_at": as_utc(todo.created_at),
        "updated_at": as_utc(todo.updated_at),
        "is_overdue": is_overdue(todo),
    }


def transition_out(item: TodoTransition) -> dict:
    return {
        "id": item.id,
        "action": item.action,
        "from_status": item.from_status,
        "to_status": item.to_status,
        "operator": person(item.operator),
        "meta": item.meta,
        "created_at": as_utc(item.created_at),
    }


def todo_detail(todo: Todo, user: User, history: list[TodoTransition]) -> dict:
    data = todo_summary(todo)
    data["available_actions"] = available_actions(todo, user)
    data["history"] = [transition_out(item) for item in history]
    return data


def notification_out(item: Notification) -> dict:
    return {
        "id": item.id,
        "type": item.type,
        "title": item.title,
        "body": item.body,
        "todo_id": item.todo_id,
        "is_read": item.read_at is not None,
        "created_at": as_utc(item.created_at),
    }
