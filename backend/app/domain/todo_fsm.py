"""基于 transitions 的待办状态机。

状态：pending -> in_progress -> completed
pending -> rejected
pending / in_progress -> pending（转交，负责人变更）
"""

from transitions import Machine

STATUSES = ["pending", "in_progress", "completed", "rejected"]

# (当前状态, action) -> 目标状态
TRANSITION_TABLE: dict[tuple[str, str], str] = {
    ("pending", "assign"): "in_progress",
    ("pending", "reject"): "rejected",
    ("pending", "transfer"): "pending",
    ("in_progress", "complete"): "completed",
    ("in_progress", "transfer"): "pending",
}

TRANSITIONS = [
    {"trigger": "assign", "source": "pending", "dest": "in_progress"},
    {"trigger": "reject", "source": "pending", "dest": "rejected"},
    {"trigger": "transfer", "source": ["pending", "in_progress"], "dest": "pending"},
    {"trigger": "complete", "source": "in_progress", "dest": "completed"},
]


class TodoFSM:
    """一次性的状态机实例：由当前状态构建，trigger 非法动作时抛 MachineError。"""

    def __init__(self, status: str) -> None:
        self.state = status
        Machine(
            model=self,
            states=STATUSES,
            initial=status,
            transitions=TRANSITIONS,
            auto_transitions=False,
            send_event=False,
        )

    def apply(self, action: str) -> str:
        """执行动作并返回目标状态；非法转换由 transitions 抛 MachineError。"""
        self.trigger(action)
        return self.state
