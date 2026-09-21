# 运营看板采集器镜像（Phase 0 调度空壳）
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

COPY pyproject.toml ./
COPY collector ./collector
RUN pip install --upgrade pip && pip install .

RUN useradd --create-home --uid 10001 appuser
USER appuser

# 采集器无 HTTP 端口，健康状态由日志与 scheduler 存活体现
CMD ["python", "-m", "collector.main"]
