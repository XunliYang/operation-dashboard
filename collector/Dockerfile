# 运营看板采集器镜像（GitHub 增量采集 + 代码量/wiki 采集）
#
# 构建上下文是 monorepo 根（见 deploy/docker-compose.yml 的 collector.build），
# 因此这里的 COPY 路径都相对仓库根。
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# 先装依赖，利用层缓存
COPY collector/pyproject.toml ./
COPY collector/collector ./collector
# 跨包复用 api 的纯函数模块 app.services.org_classifier（分类优先级 + 邮箱哈希/脱敏）
COPY api/app ./app

# git 供 wiki 采集（git clone --bare *.wiki.git）使用；清理 apt 缓存缩小镜像。
RUN apt-get update \
    && apt-get install -y --no-install-recommends git \
    && rm -rf /var/lib/apt/lists/* \
    && pip install --upgrade pip \
    && pip install .

# 非 root 运行
RUN useradd --create-home --uid 10001 appuser
USER appuser

# 采集器无 HTTP 端口，健康状态由日志与 scheduler 存活体现
CMD ["python", "-m", "collector.main"]