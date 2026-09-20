"""采集配置：环境变量前缀 `OD_`。"""

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class CollectorSettings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="OD_", extra="ignore")

    redis_url: str = "redis://localhost:6379/0"
    config_dir: str = "config"

    # 分布式锁：同一时刻只允许一个采集实例跑同一 job
    lock_ttl_seconds: int = 300
    lock_key_prefix: str = "od:collector:lock:"

    # 调度时区
    timezone: str = "Asia/Shanghai"


@lru_cache
def get_settings() -> CollectorSettings:
    return CollectorSettings()
