"""采集配置：环境变量前缀 `OD_`。"""

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class CollectorSettings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="OD_", extra="ignore")

    redis_url: str = "redis://localhost:6379/0"
    config_dir: str = "config"

    # 数据层
    database_url: str = "postgresql://od:od_dev_password@localhost:5432/operation_dashboard"

    # GitHub API（token 池：OD_GITHUB_TOKENS 逗号分隔优先；单 token 用 OD_GITHUB_TOKEN）
    github_token: str = ""
    github_tokens: str = ""
    github_api_base: str = "https://api.github.com"

    # 限流治理
    rate_limit_threshold: int = 100     # X-RateLimit-Remaining 低于此值降速
    throttle_delay_seconds: float = 0.5
    max_retries: int = 5                # 二次限流/5xx 指数退避重试次数

    # 采集窗口：首次回填与增量游标回退天数
    backfill_days: int = 90

    # Webhook
    webhook_secret: str = ""
    webhook_dedup_ttl_seconds: int = 3600

    # 分布式锁：同一时刻只允许一个采集实例跑同一 job
    lock_ttl_seconds: int = 300
    lock_key_prefix: str = "od:collector:lock:"

    # 调度时区
    timezone: str = "Asia/Shanghai"

    def github_token_list(self) -> list[str]:
        if self.github_tokens:
            return [t.strip() for t in self.github_tokens.split(",") if t.strip()]
        if self.github_token:
            return [self.github_token.strip()]
        return []


@lru_cache
def get_settings() -> CollectorSettings:
    return CollectorSettings()