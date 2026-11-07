"""应用配置：默认零依赖运行（SQLite），可通过环境变量切换 PostgreSQL。"""

from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

PROJECT_ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = PROJECT_ROOT / "data"


class Settings(BaseSettings):
    """所有配置均可通过同名环境变量覆盖，例如 DATABASE_URL、JWT_SECRET。"""

    model_config = SettingsConfigDict(
        env_file=PROJECT_ROOT / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_name: str = "协同待办"
    # 默认使用 SQLite，开箱即跑；接入 PostgreSQL 时设置：
    # DATABASE_URL=postgresql+asyncpg://user:pass@127.0.0.1:5432/todo
    database_url: str = f"sqlite+aiosqlite:///{(DATA_DIR / 'todo.db').as_posix()}"
    jwt_secret: str = "dev-only-secret-please-change-in-production"
    access_token_minutes: int = 15
    refresh_token_days: int = 14
    refresh_cookie_name: str = "todo_refresh"
    cookie_secure: bool = False
    overdue_scan_minutes: int = 5
    seed_demo_data: bool = True
    frontend_dir: Path = PROJECT_ROOT / "frontend"


settings = Settings()
