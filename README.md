# 运营看板（Operation Dashboard）

面向研发运营的多仓库数据看板：聚合仓库活跃度、成员贡献与舆情信号，输出可解释的健康分与趋势视图。

本仓库是 monorepo，当前处于**架构设计 v2 · Phase 1（GitHub 健康度 MVP）**：
采集 → 存储 → 指标 → API → 页面的全链路已打通（Webhook 优先 + 定时增量兜底、
五维度健康评分、看板 A 页面）。

## 目录结构

```
.
├── web/                  # 前端：React 19 + TS + Vite + react-router 7 + Zustand + Tailwind v4 + Recharts
│   └── src/
│       ├── core/         # api 客户端、stores、types、i18n（共享契约层）
│       ├── shell/        # 微内核壳层：插件契约、装配、布局、主题、通用组件
│       ├── components/   # ui / charts / layout 复用组件
│       └── plugins/      # 子模块插件（自注册）：overview / repos / people / sentiment / settings
├── api/                  # 后端：Python 3.12 + FastAPI + Pydantic v2 + loguru
│   └── app/
│       ├── api/          # 路由（/healthz）
│       ├── core/         # 配置、日志、统一响应包装、异常处理
│       └── middleware/   # CORS、request_id、限流、体积/URL 限制、超时
├── collector/            # 采集调度空壳：APScheduler + Redis 分布式锁接口
├── config/               # 追踪仓库 / 组织映射 / 健康权重 / 情感映射（YAML）
├── deploy/               # docker-compose.yml + nginx.conf
├── sentiment-monitor/    # 既有舆情组件（独立子项目，不在本 monorepo 中改动）
└── .github/workflows/    # CI：lint / test / build
```

## 新增一个子模块（插件）

新增或删除一个子模块 = 增删 `web/src/plugins/<id>/` 目录，内核（`shell/`、`core/`）代码不动：

1. 新建 `web/src/plugins/<id>/index.ts`，默认导出一个 `Plugin`（`id` / `order` / `titleKey` / `register(ctx)`）。
2. 在 `register(ctx)` 里调用 `registerRoute` / `registerNavItem` / `registerMessages`（词条 key 统一带 `<id>.` 前缀）。
3. 词条放同目录 `i18n.ts`、页面放 `pages/`；数据请求复用 `@/core/api`，禁止直接 `fetch`。
4. 重新 `npm run build` / `npm run dev`，插件即被自动装配，无需改任何内核文件。

## 快速开始（Docker Compose）

```bash
docker compose -f deploy/docker-compose.yml up --build
```

起来后：

- 看板前端：http://localhost:8080/ （`/overview`、`/repos/:id`、`/people`、`/sentiment`、`/settings`）
- API 健康检查：`curl -si http://localhost:8080/healthz`
- 舆情组件（独立入口，方案 A）：http://localhost:8081/

端口可用环境变量覆盖：`OD_HTTP_PORT`、`OD_SENTIMENT_PORT`。

### 端口暴露策略

| 服务 | 对外 | 说明 |
| --- | --- | --- |
| nginx | `8080` / `8081` | 唯一对外入口 |
| web / api | 否（`expose`） | 只经 nginx 访问 |
| postgres / redis | 否（`expose`） | 仅容器网络内可达 |
| sentiment-monitor | 否（`expose`） | 不直接对公网暴露，为 Phase 3 的 P0-1 铺路 |

### 关于 `deploy/Dockerfile.sentiment-monitor`

Phase 0 不改动 `sentiment-monitor/` 源码，但该组件自带的 Dockerfile 有两处会让
`compose up --build` 起不来：基础镜像 `node:18` 低于依赖 `better-sqlite3@13`
要求的 `node >= 22`（低版本编译出的原生模块运行期直接 segfault），且镜像内缺少
`python3/make/g++` 导致 node-gyp 无法编译。因此编排层在 `deploy/` 下提供了一份
补上 Node 版本与工具链的 Dockerfile，build context 仍是组件源码目录。

建议由组件 owner 把这两点并入其自身 Dockerfile，届时该文件即可删除。

## 本地开发

### 前端

```bash
cd web
npm ci
npm run dev        # http://localhost:5173，/rest/v1 自动代理到 http://localhost:8000
npm run build      # tsc -b && vite build
npm run lint
npm test
```

### 后端

需要 Python 3.12。

```bash
cd api
python -m venv .venv && source .venv/bin/activate
pip install -e '.[dev]'
uvicorn app.main:app --reload --port 8000
pytest tests -v
```

`/healthz` 响应遵循统一包装：

```json
{
  "code": 0,
  "message": "ok",
  "data": { "status": "ok", "service": "api" },
  "request_id": "1cd0b999cb964d1e9c5072067185f33a"
}
```

- `code == 0` 表示成功，非 0 为业务错误码；HTTP 状态码与 `code` 解耦。
- 请求头 `X-Request-Id` 会被透传（缺省时服务端生成），并在响应头与响应体 `request_id` 中回写，用于日志串联。

### 采集器

```bash
cd collector
python -m venv .venv && source .venv/bin/activate
pip install -e '.[dev]'
python -m collector.main                 # 常驻：APScheduler 定时增量兜底
python -m collector.main --run-once      # 单次：立即对 tracked_repos 跑一轮增量采集
pytest tests -v
```

采集器把 GitHub 事件流写入 PostgreSQL 事实表（`fact_commit` / `fact_pull_request` /
`fact_issue` / `fact_review` / `fact_workflow_run` / `fact_repo_metric_daily`），
并在 `collect_run` 记录每轮状态与 `rate_limit_remaining`。需要先由 API 侧建表：

```bash
cd api && OD_DATABASE_URL=postgresql://od:od_dev_password@localhost:5432/operation_dashboard \
  python -m app.db.migrate
```

采集凭据经 `OD_GITHUB_TOKEN`（单 token）或 `OD_GITHUB_TOKENS`（逗号分隔 token 池）注入。
未配置 Redis 时锁自动降级为 `NullLock`（单实例语义，跨实例互斥失效），日志会给出 warning。

## 配置

`config/` 下四个 YAML，字段含义写在各自文件头部注释里：

| 文件 | 作用 |
| --- | --- |
| `tracked_repos.yaml` | 追踪仓库清单、所属组织、权重、采集节流 |
| `org_mapping.yaml` | 组织/团队成员映射 |
| `health_weights.yaml` | 健康分各维度权重、方向与分档阈值 |
| `sentiment_mapping.yaml` | 情感极性区间、严重度权重、关键词兜底规则、告警阈值 |

默认监控目标是 **OpenAN 组织**（https://github.com/project-openan）：
`tracked_repos.yaml` 默认启用其 13 个公开仓库（`org_mapping.yaml` 的
`default_org: openan`）；`project-openan/.github`（纯组织配置仓）默认排除，
`XunliYang/*` 两项保留为 `enabled: false` 的冒烟/自测项。仓库 `weight` 按实质
分层——registry / orchestration 等核心基础设施最高、SDK 次之、docs / 站点 / demo /
安装器最低，避免近似空仓以等权拖低组织分。

**配额约束**：13 个 OpenAN 仓库单轮采集约 130 请求，必须配置
`OD_GITHUB_TOKEN`（单 token）或 `OD_GITHUB_TOKENS`（逗号分隔 token 池）；
未认证配额仅 60 请求/小时，无法支撑一轮完整采集。细粒度 PAT 需授予所采仓库的
`Contents`、`Issues`、`Pull requests` 读权限。

## 路由约定

nginx（`deploy/nginx.conf`）做统一入口：

- `/` → web，SPA fallback（`try_files ... /index.html`），深层链接刷新不 404
- `/rest/v1/` → api，去掉前缀后转发给 FastAPI
- `/healthz` → api，直通，便于探针使用
- 舆情走独立 server 块（端口 8081），SSE 相关 `proxy_buffering off`

后端地址通过变量 + Docker 内嵌 DNS 延迟解析。若改用 `upstream` 块写死服务名，
nginx 启动时会解析一次，任一后端容器尚在重启就会以 `host not found` 退出并反复重试，
反而把启动顺序问题放大成启动死锁。

## CI

`.github/workflows/ci.yml` 三个 job：

- `lint` — web ESLint + `tsc -b`；api / collector 的 ruff
- `test` — web vitest；api / collector 的 pytest
- `build` — web 生产构建；compose 与 nginx 配置校验；三个镜像构建 + api 镜像健康检查冒烟

## 交付模型

从最新 `main` 切任务分支 → 实现 → 推送 → 开指向 `main` 的 PR。合并由人工完成。
