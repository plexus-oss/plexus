from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    # Loaded from .env.local in dev; in prod, set via fly secrets (no file).
    model_config = SettingsConfigDict(env_file=".env.local", env_file_encoding="utf-8")

    dev_mode: bool = False
    dev_org_id: str = "dev_org"

    database_url: str

    redis_url: str = "redis://localhost:6379"

    clickhouse_host: str = "localhost"
    clickhouse_port: int = 8123
    clickhouse_secure: bool = False
    clickhouse_database: str = "plexus"
    clickhouse_user: str = "telemetry_writer"
    clickhouse_password: str = ""

    gateway_url: str = "ws://localhost:8080"

    auth_cache_ttl: int = 300
    auth_negative_cache_ttl: int = 30
    auth_disabled_cache_ttl: int = 60

    internal_secret: str = ""

    app_url: str = "https://app.plexus.company"

    # Public base URL of THIS service — used in OAuth protected-resource
    # metadata (RFC 9728) so MCP clients discover the authorization server.
    public_url: str = "https://api.plexus.company"

    video_stream_timeout: int = 600  # seconds; per-session override via ?timeout=


settings = Settings()
