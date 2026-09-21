# 运营看板 API 镜像
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# 先装依赖，利用层缓存
COPY pyproject.toml ./
COPY app ./app
COPY migrations ./migrations
RUN pip install --upgrade pip && pip install .

# 非 root 运行
RUN useradd --create-home --uid 10001 appuser
USER appuser

ENV OD_MIGRATIONS_DIR=/app/migrations

EXPOSE 8000

HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
    CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/healthz').status==200 else 1)"

# 启动前先跑迁移（best-effort，DB 未就绪时跳过，不阻塞 uvicorn）
CMD ["/bin/sh", "-c", "python -m app.db.migrate 3 || echo 'migrations skipped (DB unavailable)'; exec uvicorn app.main:app --host 0.0.0.0 --port 8000"]