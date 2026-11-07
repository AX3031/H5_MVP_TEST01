"""状态机相关的纯业务规则，便于服务端与序列化层共享。"""

from ..models import Todo, User

STATUS_LABELS = {
    "pending": "待处理",
    "in_progress": "进行中",
    "completed": "已完成",
    "rejected": "已驳回",
}

# 某状态下存在哪些动作（与角色无关）
STATUS_ACTIONS: dict[str, set[str]] = {
    "pending": {"assign", "reject", "transfer"},
    "in_progress": {"complete", "transfer"},
    "completed": set(),
    "rejected": set(),
}

ACTION_LABELS = {
    "create": "创建待办",
    "assign": "确认接收",
    "reject": "驳回",
    "transfer": "转交",
    "complete": "标记完成",
}


def available_actions(todo: Todo, user: User) -> list[str]:
    """服务端权限计算的唯一真相源：前端只渲染，不自行判断。"""
    actions: list[str] = []
    is_assignee = todo.assignee_id == user.id
    is_creator = todo.creator_id == user.id
    if todo.status == "pending":
        if is_assignee:
            actions = ["assign", "reject", "transfer"]
        elif is_creator:
            actions = ["transfer"]
    elif todo.status == "in_progress":
        if is_assignee:
            actions = ["complete", "transfer"]
    return actions
