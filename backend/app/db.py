from concurrent.futures import ThreadPoolExecutor
from urllib.parse import quote_plus, urlparse
import socket

import psycopg
from supabase import Client, create_client

from app.config import settings

_client: Client | None = None

PLATFORMS = ("crowdworks", "lancers", "coconala")
JOB_STATUSES = (
    "NEW",
    "RECORDED",
    "QUEUED",
    "SENT_TO_BIDER",
    "PROCESSING",
    "PROPOSAL_PAGE_READY",
    "WAITING_FOR_USER",
    "COMPLETED",
    "SKIPPED",
)

_POOLER_REGIONS = (
    "us-east-2",
    "us-east-1",
    "ap-northeast-1",
    "ap-southeast-1",
    "us-west-2",
    "eu-west-1",
    "eu-central-1",
    "ap-northeast-2",
    "ap-southeast-2",
    "us-west-1",
    "ap-south-1",
    "ca-central-1",
    "eu-west-2",
    "ap-northeast-3",
)


def project_ref() -> str:
    host = settings.supabase_url.replace("https://", "").replace("http://", "").split("/")[0]
    return host.split(".")[0]


def supabase() -> Client:
    global _client
    if _client is None:
        _client = create_client(settings.supabase_url, settings.supabase_service_role_key)
    return _client


def _password() -> str:
    return quote_plus(settings.supabase_db_password)


def _ipv4(hostname: str, timeout: float = 3.0) -> list[str]:
    def lookup() -> list[str]:
        infos = socket.getaddrinfo(hostname, None, socket.AF_INET, socket.SOCK_STREAM)
        seen: list[str] = []
        for info in infos:
            ip = info[4][0]
            if ip not in seen:
                seen.append(ip)
        return seen

    try:
        with ThreadPoolExecutor(max_workers=1) as pool:
            return pool.submit(lookup).result(timeout=timeout)
    except Exception:
        return []


def postgres_targets():
    ref = project_ref()
    pw = _password()
    for region in _POOLER_REGIONS:
        for prefix in ("aws-0", "aws-1"):
            host = f"{prefix}-{region}.pooler.supabase.com"
            if not _ipv4(host):
                continue
            for user in (f"postgres.{ref}", "postgres"):
                user_label = "project-user" if "." in user else "postgres"
                for port in (6543, 5432):
                    yield (
                        f"pooler-{port}-{prefix}-{region}-{user_label}",
                        f"postgresql://{user}:{pw}@{host}:{port}/postgres?sslmode=require",
                    )
    direct_host = f"db.{ref}.supabase.co"
    if _ipv4(direct_host):
        yield (
            "direct-5432",
            f"postgresql://postgres:{pw}@{direct_host}:5432/postgres?sslmode=require",
        )


def redact_error(exc: BaseException) -> str:
    text = str(exc)
    raw = settings.supabase_db_password
    encoded = _password()
    return text.replace(raw, "***").replace(encoded, "***")


def connect_postgres():
    last_err: BaseException | None = None
    tried: list[str] = []
    for label, dsn in postgres_targets():
        try:
            print(f"Trying {label}...")
            conn = _connect_dsn(dsn, timeout=6)
            conn.autocommit = True
            conn.execute("select 1")
            print(f"Postgres connected ({label})")
            return conn
        except Exception as exc:  # noqa: BLE001 - try next host
            last_err = exc
            tried.append(f"{label}: {redact_error(exc)}")
            continue
    detail = " | ".join(tried[:12]) or "no reachable hosts"
    raise ConnectionError(f"Postgres connection failed. {detail}") from last_err


def _connect_dsn(dsn: str, timeout: int):
    parsed = urlparse(dsn)
    host = parsed.hostname
    port = parsed.port or 5432
    ipv4_err: BaseException | None = None
    for ip in _ipv4(host or ""):
        try:
            return psycopg.connect(
                dsn,
                hostaddr=ip,
                connect_timeout=timeout,
                prepare_threshold=None,
            )
        except Exception as exc:  # noqa: BLE001
            ipv4_err = exc
    try:
        return psycopg.connect(dsn, connect_timeout=timeout, prepare_threshold=None)
    except Exception:
        if ipv4_err:
            raise ipv4_err
        raise


def database_url() -> str:
    ref = project_ref()
    password = _password()
    return f"postgresql://postgres.{ref}:{password}@aws-0-ap-northeast-1.pooler.supabase.com:6543/postgres?sslmode=require"
