"""FastAPI 入口：初始化数据库、演示数据、后台任务与 H5 静态资源。"""

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from .config import settings
from .db import Base, SessionLocal, engine
from .routers import auth, notifications, org, todos
from .seed import seed_demo_data
from .services.scheduler import start_scheduler, stop_scheduler


@asynccontextmanager
async def lifespan(_app: FastAPI):
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    if settings.seed_demo_data:
        async with SessionLocal() as session:
            await seed_demo_data(session)

    start_scheduler()
    yield
    stop_scheduler()
    await engine.dispose()


app = FastAPI(title="协同待办 API", version="0.1.0", lifespan=lifespan)

app.include_router(auth.router, prefix="/api/v1/auth", tags=["认证"])
app.include_router(org.router, prefix="/api/v1", tags=["组织"])
app.include_router(todos.router, prefix="/api/v1/todos", tags=["待办"])
app.include_router(notifications.router, prefix="/api/v1/notifications", tags=["通知"])


@app.get("/api/health")
async def health() -> dict:
    return {"status": "ok", "app": settings.app_name}


if settings.frontend_dir.exists():
    app.mount("/", StaticFiles(directory=settings.frontend_dir, html=True), name="h5")
