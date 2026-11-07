# 协同待办 H5

> **AI 生成声明**
>
> 本项目由 AI 根据《需求文档.txt》一次性生成，无人工修改。

一个移动端优先的团队待办协同工具。用户可以创建待办并指派给团队成员，接收方在 H5 中确认接收、完成、转交或驳回；所有状态流转都由服务端状态机校验，并写入不可省略的流转审计记录。

## 功能概览

- 注册 / 登录 / 登出，支持创建团队或使用邀请码加入团队
- 创建待办：标题、描述、负责人、截止时间
- 状态流转：确认接收、完成、转交、驳回
- 流转历史：记录操作人、动作、前后状态、原因与转交对象
- 服务端计算 `available_actions`，前端只负责渲染按钮，不自行判断权限
- 同组织成员可见、可转交；非法状态流转返回 `409`，越权操作返回 `403`
- 站内通知：指派、转交、驳回、完成、逾期提醒
- 逾期扫描：APScheduler 定时任务，每个待办每天最多提醒一次
- JWT 认证：Access Token 仅保存在内存，Refresh Token 使用 httpOnly Cookie 并轮换
- 移动端优先的响应式 H5，无前端构建步骤

## 快速开始

### 环境要求

- Python 3.12+（本次开发验证使用 Python 3.14.7）
- 不需要 Node.js、PostgreSQL 或 Redis

### 安装依赖

当前工作区已包含 `.venv`（不会提交到 Git），在项目根目录执行：

```powershell
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
```

如果 `.venv` 中没有 pip：

```powershell
.\.venv\Scripts\python.exe -m ensurepip --upgrade
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
```

也可以自行创建虚拟环境后安装：

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
```

### 启动服务

```powershell
.\.venv\Scripts\python.exe main.py
```

看到 Uvicorn 启动日志后，在浏览器打开：

- 应用：`http://127.0.0.1:8000`
- 接口文档：`http://127.0.0.1:8000/docs`

首次启动会自动建表并写入演示数据；数据默认保存在 `data/todo.db`。

如果 8000 端口被占用，可以改用其他端口：

```powershell
.\.venv\Scripts\python.exe -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8001
```

### 演示账号

| 邮箱 | 密码 | 姓名 |
|---|---|---|
| `lin@demo.com` | `demo1234` | 林知夏 |
| `chen@demo.com` | `demo1234` | 陈屿 |
| `su@demo.com` | `demo1234` | 苏晚 |

演示团队邀请码：`XINGYE`

建议使用两个浏览器窗口分别登录不同成员，体验“创建 → 确认接收 → 转交 → 驳回”的协同流程。

### 重置演示数据

停止服务后删除 `data/todo.db`（以及同目录下的 `todo.db-wal`、`todo.db-shm`），再次启动即可重新生成演示数据。

## 使用流程

1. 使用演示账号登录，进入“我的待办”列表
2. 点击右下角“新建待办”，填写标题、描述、负责人和截止时间
3. 创建后进入详情页；创建者只能转交，负责人可以确认接收、转交或驳回
4. 确认接收后状态变为“进行中”，负责人可以标记完成或继续转交
5. 每次状态变化都会出现在详情页的“流转记录”中
6. 顶部铃铛显示未读通知，通知按今天 / 昨天 / 更早分组
7. 账号菜单中可复制团队邀请码，供新同事注册时加入团队

## 状态机

| 当前状态 | 动作 | 目标状态 | 可执行角色 | 必填字段 |
|---|---|---|---|---|
| — | `create` | `pending` | 创建者 | `title`、`assignee_id` |
| `pending` | `assign` | `in_progress` | 当前负责人 | — |
| `pending` | `reject` | `rejected` | 当前负责人 | `reject_reason` |
| `pending` | `transfer` | `pending` | 当前负责人或创建者 | `new_assignee_id` |
| `in_progress` | `complete` | `completed` | 当前负责人 | — |
| `in_progress` | `transfer` | `pending` | 当前负责人 | `new_assignee_id` |

状态机使用 `transitions` 在领域层执行；状态变更与 `todo_transitions` 审计记录在同一数据库事务中提交。

## 技术栈

| 层 | 实现 |
|---|---|
| 前端 | 原生 JavaScript + CSS，移动端优先，无构建步骤 |
| 后端 | FastAPI + Pydantic v2 |
| ORM / 数据库 | SQLAlchemy 2.x async + SQLite（aiosqlite） |
| 状态机 | `transitions` |
| 认证 | PyJWT（Access Token）+ httpOnly Refresh Cookie 轮换 |
| 密码哈希 | bcrypt |
| 定时任务 | APScheduler（进程内，每 5 分钟扫描逾期） |
| 通知 | 落库 + 前端每 25 秒轮询未读数 |

本项目按需求文档“PostgreSQL 单库支撑 MVP、不引入 Redis”的思路实现。为了在本机零配置启动，默认使用 SQLite；所有状态机、审计、通知、逾期扫描都不依赖 Redis。

## 目录结构

```text
project4/
├── backend/
│   ├── app/
│   │   ├── main.py              # FastAPI 入口、静态资源挂载、lifespan
│   │   ├── config.py            # pydantic-settings 配置
│   │   ├── db.py                # 异步引擎与会话
│   │   ├── models.py            # 组织、用户、待办、审计、通知、刷新令牌
│   │   ├── schemas.py           # 请求 / 响应模型
│   │   ├── serializers.py       # 模型到响应的序列化
│   │   ├── seed.py              # 演示数据
│   │   ├── security.py          # bcrypt 与 JWT
│   │   ├── deps.py              # 当前用户依赖
│   │   ├── domain/
│   │   │   ├── todo_fsm.py      # transitions 状态机
│   │   │   └── rules.py         # available_actions 等规则
│   │   ├── routers/             # auth / org / todos / notifications
│   │   └── services/            # 待办服务、通知、逾期扫描
│   └── ...
├── frontend/
│   ├── index.html
│   └── assets/                  # styles.css、api.js、ui.js、app.js、icons.js
├── data/                        # 运行时 SQLite 数据（已忽略）
├── main.py                      # 本地启动入口
├── requirements.txt
├── pyproject.toml
└── README.md
```

## 配置

配置来自环境变量或项目根目录的 `.env`，字段定义见 `backend/app/config.py`。

| 变量 | 默认值 | 说明 |
|---|---|---|
| `DATABASE_URL` | `sqlite+aiosqlite:///.../data/todo.db` | 数据库连接；切换 PostgreSQL 需额外安装 `asyncpg` |
| `JWT_SECRET` | 开发默认值 | 生产环境必须替换 |
| `ACCESS_TOKEN_MINUTES` | `15` | Access Token 有效期 |
| `REFRESH_TOKEN_DAYS` | `14` | Refresh Token 有效期 |
| `COOKIE_SECURE` | `false` | HTTPS 部署时应设为 `true` |
| `OVERDUE_SCAN_MINUTES` | `5` | 逾期扫描间隔 |
| `SEED_DEMO_DATA` | `true` | 空库启动时是否写入演示数据 |

切换到 PostgreSQL 时需要安装 `asyncpg` 并设置，例如：

```powershell
.\.venv\Scripts\python.exe -m pip install asyncpg
$env:DATABASE_URL = "postgresql+asyncpg://user:password@127.0.0.1:5432/todo"
```

当前项目使用 `Base.metadata.create_all` 自动建表，没有引入 Alembic 迁移。

## 主要 API

| 方法 | 路径 | 说明 |
|---|---|---|
| `POST` | `/api/v1/auth/register` | 注册，可创建团队或加入团队 |
| `POST` | `/api/v1/auth/login` | 登录，Refresh Token 写入 httpOnly Cookie |
| `POST` | `/api/v1/auth/refresh` | 刷新并轮换 Refresh Token |
| `POST` | `/api/v1/auth/logout` | 撤销 Refresh Token |
| `GET` | `/api/v1/members` | 同组织成员列表 |
| `GET` | `/api/v1/todos?scope=mine` | 我的待办 |
| `GET` | `/api/v1/todos?scope=created` | 我创建的待办 |
| `GET` | `/api/v1/todos?scope=all` | 团队全部待办 |
| `POST` | `/api/v1/todos` | 创建待办 |
| `GET` | `/api/v1/todos/{id}` | 详情、`available_actions`、流转历史 |
| `POST` | `/api/v1/todos/{id}/transition` | 统一流转入口 |
| `GET` | `/api/v1/notifications` | 通知列表 |
| `GET` | `/api/v1/notifications/unread-count` | 未读数 |
| `POST` | `/api/v1/notifications/read-all` | 全部已读 |

## 测试记录

已在本地完成以下验证：

- API 冒烟测试：登录、创建、非法流转 `409`、越权 `403`、转交、驳回、完成、审计、通知、Refresh 轮换、登出后刷新失败
- 浏览器实测：登录、列表筛选、创建待办、确认接收、标记完成、转交、驳回、通知、刷新页面恢复会话
- 并发测试：对同一 `pending` 待办同时发起两个 `assign` 请求，两个请求都返回 `200`，审计中出现两条 `assign`（见下方已知问题 2）

## 已知问题（未修复）

> 本次任务只新增文档，不修改任何业务代码。以下问题按现状记录，供后续迭代处理。

### 1. 登录密码错误后按钮一直转圈（高）

**复现步骤**

1. 打开登录页
2. 输入正确邮箱（例如 `lin@demo.com`）和错误密码（至少 8 位）
3. 点击“登录”

**实际结果**

- 服务端返回 `401 Unauthorized`
- 按钮保持禁用并持续显示加载动画
- 页面没有显示“邮箱或密码不正确”等错误提示

**期望结果**

- 显示明确的登录失败提示
- 按钮恢复可点击状态

**原因定位**

`frontend/assets/app.js` 的登录表单 `catch` 分支中有一行：

```js
if (error.status === 401) return;
```

该判断本意是避免全局会话失效时的重复跳转，但它同样拦截了登录接口本身的 `401`，导致后面的错误提示和按钮状态恢复都没有执行。注册表单复用了同一段 `catch` 逻辑，若服务端返回 `401` 也会出现同类问题。

### 2. 并发流转可能重复写入审计（高，已复现）

**复现步骤**

对同一个 `pending` 待办的 `POST /api/v1/todos/{id}/transition` 同时发起两个 `assign` 请求。

**实际结果**

- 两个请求都返回 `200`
- 待办最终为 `in_progress`
- 流转历史出现两条 `assign`：`["create", "assign", "assign"]`

**期望结果**

- 只有一个请求成功，另一个返回 `409 Conflict`
- 审计中只出现一条 `assign`

**原因定位**

默认 SQLite 不支持 `SELECT ... FOR UPDATE`，`todo_service.get_todo(..., for_update=True)` 在该数据库上不会真正加锁；同时没有增加版本号或“比较并交换”条件。两个请求都可能读到 `pending`，然后各自提交状态和审计。切换到 PostgreSQL 能获得真正的行锁，但服务层仍建议补充乐观锁或原子更新，避免重复流转。

### 3. 浏览器返回栈异常（低，已复现）

**复现步骤**

1. 从列表进入待办详情
2. 点击页面左上角的“返回”
3. 点击浏览器（或手机系统）的返回

**实际结果**

浏览器返回又回到了刚才的详情页，而不是列表页或上一级页面。

**期望结果**

浏览器返回应回到进入详情前的列表页。

**原因定位**

详情页的“返回”按钮调用 `navigate("/todos")`，会新增一条 hash 历史记录，而不是调用 `history.back()`。类似地，从通知页进入详情后，应用内“返回”总是回列表，会丢失通知页上下文。

### 4. 多标签页刷新可能导致互相踢下线（中，机制风险）

Refresh Token 采用“一次使用即轮换”的策略，服务端只保留当前有效的 Refresh Token 记录。多个标签页同时刷新页面时，可能同时使用同一个 Refresh Cookie：第一个请求轮换成功后，旧 Token 被撤销，第二个请求会收到 `401`，从而清除登录态并跳回登录页。

该问题尚未做双标签页专项实测，属于基于刷新机制的潜在风险。后续可考虑使用 `BroadcastChannel` 同步 Token，或采用更宽松的多设备 Refresh Token 策略。

## 已知限制与安全提醒

- 登录接口没有失败次数限制或验证码，生产环境存在暴力破解风险
- `JWT_SECRET` 有开发默认值，生产环境必须通过环境变量替换
- 默认使用 HTTP，`COOKIE_SECURE=false`；生产环境应启用 HTTPS 并设置 `COOKIE_SECURE=true`
- Refresh / Logout 依赖 Cookie 的 `SameSite=Lax`，没有额外 CSRF Token
- 通知通过 25 秒轮询更新，不是实时推送；未实现需求文档中提及的 `LISTEN/NOTIFY` 或 WebSocket
- SQLite 适合单实例演示；多 worker 部署时 APScheduler 会重复执行逾期扫描
- 列表和通知接口有查询上限（待办 100 条、通知 50 条），前端没有分页
- 演示数据的截止时间按北京时间生成，其他时区查看时可能显示为不同的本地时间
- 未实现待办的编辑、删除、评论、附件和搜索
