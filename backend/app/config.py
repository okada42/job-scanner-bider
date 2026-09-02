from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(ROOT / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    supabase_url: str = ""
    supabase_anon_key: str = ""
    supabase_service_role_key: str = ""
    supabase_db_password: str = ""
    discord_webhook_url: str = ""
    api_token: str = "change-me"
    scan_interval_seconds: int = 60
    # html = backend crawls listing pages. extension = skip that loop; jobs arrive via POST /api/jobs/ingest.
    scan_mode: str = "html"
    backend_host: str = "0.0.0.0"
    backend_port: int = 8000
    job_scanner_db: str = ""
    job_scanner_local_store: str = ""
    # Calendar day for the Sources "Found" column. Midnight here resets the count.
    scanner_tz: str = "Asia/Tokyo"


settings = Settings()


def get_settings() -> Settings:
    return settings


def use_local_store() -> bool:
    flag = (settings.job_scanner_local_store or "").strip().lower()
    if flag in {"1", "true", "yes", "on"}:
        return True
    if flag in {"0", "false", "no", "off"}:
        return False
    url = (settings.supabase_url or "").strip().lower()
    if not url:
        return True
    if "example.supabase.co" in url or "your_project" in url:
        return True
    if not (settings.supabase_service_role_key or "").strip():
        return True
    return False


def local_db_path() -> Path:
    if settings.job_scanner_db:
        return Path(settings.job_scanner_db)
    return ROOT / "data" / "job-scanner.db"
