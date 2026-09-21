"""应用配置：通过环境变量覆盖，前缀 `OD_`。"""

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="OD_", env_file=".env", extra="ignore")

    app_name: str = "operation-dashboard-api"
    env: str = "dev"
    debug: bool = False

    # 服务监听
    host: str = "0.0.0.0"
    port: int = 8000

    # CORS：仅 dev 生效，生产由 nginx 同源代理
    cors_origins: list[str] = ["http://localhost:5173", "http://localhost:8080"]

    # 请求限制
    request_timeout_seconds: float = 30.0
    max_body_bytes: int = 2 * 1024 * 1024  # 2 MiB
    max_url_length: int = 2048

    # 限流：每 IP 每分钟请求数
    rate_limit_per_minute: int = 300

    # 数据层：PostgreSQL 连接串（psycopg 风格）
    database_url: str = "postgresql://od:od_dev_password@localhost:5432/operation_dashboard"

    # 配置目录：health_weights.yaml / tracked_repos.yaml 存放处
    config_dir: str = "config"

    # 健康分窗口（天）：指标按最近 N 天的滚动窗口计算
    health_window_days: int = 30

    # 邮箱哈希盐：dim_contributor.email_hash = sha256(salt + lower(email))。
    # 生产环境务必通过 OD_EMAIL_HASH_SALT 覆盖为随机值；盐一旦确定不可更改
    # （否则历史哈希全部失效、无法按邮箱聚类身份）。
    email_hash_salt: str = "operation-dashboard-dev-salt"

    # 舆情只读服务（sentiment-monitor）：BFF 代理其只读端点，前端不直连此地址。
    sentiment_base_url: str = "http://sentiment-monitor:3000"
    sentiment_timeout_seconds: float = 5.0
    # 舆情服务若启用凭据（SENTIMENT_AUTH_TOKEN），BFF 携带该 token 调用。
    sentiment_auth_token: str = ""

    @property
    def is_dev(self) -> bool:
        return self.env.lower() in {"dev", "local", "development"}


@lru_cache
def get_settings() -> Settings:
    return Settings()
