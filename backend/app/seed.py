"""首次启动时写入演示数据，方便直接体验协同流转。"""

from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from .models import Organization, Todo, TodoTransition, User, utcnow
from .security import hash_password
from .services.notifications import notify

DEMO_ORG_CODE = "XINGYE"
DEMO_PASSWORD = "demo1234"
CN_TZ = timezone(timedelta(hours=8))


def _person(user: User) -> dict:
    return {"id": str(user.id), "display_name": user.display_name}


async def seed_demo_data(session: AsyncSession) -> bool:
    if await session.scalar(select(func.count(User.id))):
        return False

    now = utcnow()

    def local_at(days: int, hour: int) -> datetime:
        """演示数据的截止时间按北京时间整点生成，展示更自然。"""
        target = (now.astimezone(CN_TZ) + timedelta(days=days)).replace(
            hour=hour, minute=0, second=0, microsecond=0
        )
        return target.astimezone(timezone.utc)

    org = Organization(
        name="星野产品实验室",
        code=DEMO_ORG_CODE,
        created_at=now - timedelta(days=60),
    )
    session.add(org)
    await session.flush()

    password_hash = hash_password(DEMO_PASSWORD)
    lin = User(
        email="lin@demo.com",
        password_hash=password_hash,
        display_name="林知夏",
        org=org,
        created_at=now - timedelta(days=45),
    )
    chen = User(
        email="chen@demo.com",
        password_hash=password_hash,
        display_name="陈屿",
        org=org,
        created_at=now - timedelta(days=44),
    )
    su = User(
        email="su@demo.com",
        password_hash=password_hash,
        display_name="苏晚",
        org=org,
        created_at=now - timedelta(days=43),
    )
    session.add_all([lin, chen, su])
    await session.flush()

    async def add_todo(
        title: str,
        description: str,
        creator: User,
        assignee: User,
        status: str,
        created_hours_ago: float,
        due_at: datetime | None,
        *,
        reject_reason: str | None = None,
        transferred_from: User | None = None,
    ) -> Todo:
        created = now - timedelta(hours=created_hours_ago)
        due = due_at
        todo = Todo(
            org_id=org.id,
            title=title,
            description=description,
            status=status,
            assignee=assignee,
            creator=creator,
            due_date=due,
            reject_reason=reject_reason,
            created_at=created,
            updated_at=created,
        )
        session.add(todo)
        await session.flush()

        events = [(created, "create", creator.id, None, "pending", {"assignee": _person(assignee)})]
        if transferred_from is not None:
            transferred_at = created + timedelta(hours=created_hours_ago / 2)
            events.append(
                (
                    transferred_at,
                    "transfer",
                    creator.id,
                    "pending",
                    "pending",
                    {
                        "from_assignee": _person(transferred_from),
                        "to_assignee": _person(assignee),
                    },
                )
            )
        elif status in ("in_progress", "completed"):
            events.append(
                (
                    created + timedelta(minutes=25),
                    "assign",
                    assignee.id,
                    "pending",
                    "in_progress",
                    {},
                )
            )
        if status == "completed":
            events.append(
                (
                    created + timedelta(hours=4),
                    "complete",
                    assignee.id,
                    "in_progress",
                    "completed",
                    {},
                )
            )
        elif status == "rejected":
            events.append(
                (
                    created + timedelta(minutes=40),
                    "reject",
                    assignee.id,
                    "pending",
                    "rejected",
                    {"reason": reject_reason},
                )
            )

        for event_time, action, operator_id, from_status, to_status, meta in events:
            session.add(
                TodoTransition(
                    todo_id=todo.id,
                    from_status=from_status,
                    to_status=to_status,
                    action=action,
                    operator_id=operator_id,
                    meta=meta,
                    created_at=event_time,
                )
            )
        todo.updated_at = events[-1][0]
        return todo

    release = await add_todo(
        "整理 V1.2 版本发布清单",
        "对齐 iOS / Android / H5 三端的发布项，输出 checklist 并在群里同步风险点。",
        chen,
        lin,
        "pending",
        3,
        local_at(1, 18),
    )
    login_issue = await add_todo(
        "排查登录态刷新偶发失效",
        "复现 401 后刷新失败场景，重点检查并发请求下的 refresh 单飞逻辑。",
        su,
        lin,
        "in_progress",
        30,
        local_at(0, 18),
    )
    tracking = await add_todo(
        "补充移动端埋点方案",
        "覆盖待办创建、状态流转、通知点击三个关键路径，输出字段定义表。",
        lin,
        su,
        "pending",
        5,
        local_at(3, 18),
    )
    office = await add_todo(
        "周五前提交异地办公申请",
        "行政要求本周五前完成，请提醒相关同学补齐材料。",
        lin,
        chen,
        "pending",
        50,
        local_at(-1, 18),
    )
    weekly = await add_todo(
        "输出上周业务数据周报",
        "包含新增用户、待办完成率、平均处理时长三个核心指标。",
        lin,
        chen,
        "completed",
        72,
        local_at(-2, 18),
    )
    notify_center = await add_todo(
        "评估通知中心改版方案",
        "对比抽屉式与独立页两种交互，给出改版建议。",
        lin,
        su,
        "rejected",
        24,
        local_at(5, 18),
        reject_reason="需求尚未定稿，建议下周再排期。",
    )
    design = await add_todo(
        "对接设计稿验收与走查",
        "与设计同学确认 12 个页面的走查问题，收敛后进入开发排期。",
        su,
        lin,
        "pending",
        20,
        local_at(2, 18),
        transferred_from=chen,
    )

    # 通知：为演示账号准备未读与已读样例
    notify(
        session,
        lin.id,
        release.id,
        "todo_created",
        "你收到一个新待办",
        f"陈屿 指派给你：{release.title}",
        created_at=now - timedelta(hours=3),
    )
    notify(
        session,
        lin.id,
        design.id,
        "todo_transferred",
        "有一个待办转交给你",
        f"苏晚 将「{design.title}」转交给你",
        created_at=now - timedelta(hours=10),
    )
    notify(
        session,
        lin.id,
        notify_center.id,
        "todo_rejected",
        "待办被驳回",
        f"苏晚 驳回了「{notify_center.title}」：{notify_center.reject_reason}",
        created_at=now - timedelta(hours=20),
    )
    notify(
        session,
        lin.id,
        weekly.id,
        "todo_completed",
        "待办已完成",
        f"陈屿 完成了「{weekly.title}」",
        created_at=now - timedelta(hours=50),
    ).read_at = now - timedelta(hours=48)

    notify(
        session,
        su.id,
        tracking.id,
        "todo_created",
        "你收到一个新待办",
        f"林知夏 指派给你：{tracking.title}",
        created_at=now - timedelta(hours=5),
    )
    notify(
        session,
        su.id,
        login_issue.id,
        "todo_assigned",
        "待办已开始处理",
        f"林知夏 开始处理「{login_issue.title}」",
        created_at=now - timedelta(hours=28),
    )

    notify(
        session,
        chen.id,
        office.id,
        "todo_created",
        "你收到一个新待办",
        f"林知夏 指派给你：{office.title}",
        created_at=now - timedelta(hours=50),
    ).read_at = now - timedelta(hours=48)
    notify(
        session,
        chen.id,
        office.id,
        "todo_overdue",
        "待办已逾期",
        f"「{office.title}」原定 {office.due_date.astimezone().strftime('%m月%d日 %H:%M')} 前完成，请尽快处理。",
        dedupe_key=f"overdue:{office.id}:{now.date().isoformat()}",
        created_at=now - timedelta(hours=1),
    )

    await session.commit()
    return True
