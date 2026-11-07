"""Pydantic v2 请求 / 响应模型。"""

import re
import uuid
from datetime import datetime, timezone
from typing import Annotated, Any, Literal

from pydantic import BaseModel, BeforeValidator, Field, field_validator

Action = Literal["assign", "reject", "transfer", "complete"]
TodoStatus = Literal["pending", "in_progress", "completed", "rejected"]
Scope = Literal["mine", "created", "all"]

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def _ensure_utc(value: Any) -> Any:
    if isinstance(value, datetime) and value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value


UtcDateTime = Annotated[datetime, BeforeValidator(_ensure_utc)]


class RegisterIn(BaseModel):
    email: str = Field(min_length=5, max_length=254)
    password: str = Field(min_length=8, max_length=72)
    display_name: str = Field(min_length=1, max_length=24)
    org_name: str | None = Field(default=None, max_length=40)
    org_code: str | None = Field(default=None, max_length=12)

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: str) -> str:
        value = value.strip().lower()
        if not EMAIL_RE.match(value):
            raise ValueError("请输入有效的邮箱地址")
        return value

    @field_validator("password")
    @classmethod
    def check_password_bytes(cls, value: str) -> str:
        if len(value.encode("utf-8")) > 72:
            raise ValueError("密码过长（最多 72 字节）")
        return value

    @field_validator("display_name", "org_name", "org_code")
    @classmethod
    def strip_text(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = value.strip()
        return value or None


class LoginIn(BaseModel):
    email: str = Field(min_length=5, max_length=254)
    password: str = Field(min_length=1, max_length=128)

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: str) -> str:
        return value.strip().lower()


class OrgBrief(BaseModel):
    id: uuid.UUID
    name: str
    code: str


class UserOut(BaseModel):
    id: uuid.UUID
    email: str
    display_name: str
    org: OrgBrief


class AuthOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int
    user: UserOut


class MemberOut(BaseModel):
    id: uuid.UUID
    display_name: str
    email: str
    is_self: bool


class OrgDetailOut(BaseModel):
    id: uuid.UUID
    name: str
    code: str
    member_count: int


class TodoCreateIn(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=2000)
    assignee_id: uuid.UUID
    due_date: UtcDateTime | None = None

    @field_validator("title")
    @classmethod
    def strip_title(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("标题不能为空")
        return value

    @field_validator("description")
    @classmethod
    def strip_description(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = value.strip()
        return value or None


class TransitionIn(BaseModel):
    action: Action
    new_assignee_id: uuid.UUID | None = None
    reject_reason: str | None = Field(default=None, max_length=500)


class PersonOut(BaseModel):
    id: uuid.UUID
    display_name: str


class HistoryOut(BaseModel):
    id: int
    action: str
    from_status: str | None
    to_status: str
    operator: PersonOut
    meta: dict[str, Any] | None
    created_at: UtcDateTime


class TodoOut(BaseModel):
    id: uuid.UUID
    title: str
    description: str | None
    status: TodoStatus
    assignee: PersonOut
    creator: PersonOut
    due_date: UtcDateTime | None
    reject_reason: str | None
    created_at: UtcDateTime
    updated_at: UtcDateTime
    is_overdue: bool


class TodoDetailOut(TodoOut):
    available_actions: list[Action]
    history: list[HistoryOut]


class TodoListOut(BaseModel):
    items: list[TodoOut]
    counts: dict[str, int]
    total: int
    scope: Scope


class NotificationOut(BaseModel):
    id: int
    type: str
    title: str
    body: str | None
    todo_id: uuid.UUID | None
    is_read: bool
    created_at: UtcDateTime


class NotificationListOut(BaseModel):
    items: list[NotificationOut]
    unread: int


class CountOut(BaseModel):
    unread: int
