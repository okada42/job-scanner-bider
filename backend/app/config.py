from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(ROOT / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    supabase_url: str
    supabase_anon_key: str
    supabase_service_role_key: str
    supabase_db_password: str
    discord_webhook_url: str = ""
    api_token: str
    scan_interval_seconds: int = 20
    # html = Railway fetches listing pages (anonymous). extension = skip that loop; use POST /api/jobs/ingest.
    scan_mode: str = "html"
    backend_host: str = "0.0.0.0"
    backend_port: int = 8000


settings = Settings()


def get_settings() -> Settings:
    return settings
