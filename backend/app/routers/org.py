"""组织与成员路由：成员列表用于指派 / 转交。"""

from fastapi import APIRouter
from sqlalchemy import func, select

from ..deps import CurrentUser, SessionDep
from ..models import User
from ..schemas import MemberOut, OrgDetailOut

router = APIRouter()


@router.get("/org", response_model=OrgDetailOut)
async def current_org(user: CurrentUser, session: SessionDep) -> dict:
    member_count = await session.scalar(
        select(func.count(User.id)).where(User.org_id == user.org_id)
    )
    return {
        "id": user.org.id,
        "name": user.org.name,
        "code": user.org.code,
        "member_count": member_count or 0,
    }


@router.get("/members", response_model=list[MemberOut])
async def members(user: CurrentUser, session: SessionDep) -> list[dict]:
    rows = await session.scalars(
        select(User).where(User.org_id == user.org_id).order_by(User.created_at.asc())
    )
    return [
        {
            "id": member.id,
            "display_name": member.display_name,
            "email": member.email,
            "is_self": member.id == user.id,
        }
        for member in rows
    ]
