from __future__ import annotations

from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, Field, HttpUrl

Platform = Literal["crowdworks", "lancers", "coconala"]
BiderMode = Literal["auto", "semi-auto", "paused"]


class Rules(BaseModel):
    minimum_budget: int | None = None
    maximum_budget: int | None = None
    maximum_applications: int | None = None
    keywords: list[str] = Field(default_factory=list)
    category: str | None = None


class SourceCreate(BaseModel):
    name: str | None = None
    platform: Platform
    url: HttpUrl
    enabled: bool = True
    scan_interval: int = 60
    rules: Rules = Field(default_factory=Rules)


class SourceUpdate(BaseModel):
    name: str | None = None
    url: HttpUrl | None = None
    enabled: bool | None = None
    scan_interval: int | None = None
    rules: Rules | None = None


class JobStatusUpdate(BaseModel):
    status: str
    metadata: dict[str, Any] = Field(default_factory=dict)


class ClaimItem(BaseModel):
    job_id: str
    status: str = "QUEUED"
    url: str | None = None


class ClaimBatch(BaseModel):
    claims: list[ClaimItem] = Field(default_factory=list)
    actor: str | None = None


class BiderSettingsUpdate(BaseModel):
    enabled: bool | None = None
    mode: BiderMode | None = None
    max_active_jobs: int | None = None
    max_queue_size: int | None = None
    delay_between_jobs: int | None = None
    auto_next: bool | None = None


class ScannerControlUpdate(BaseModel):
    enabled: bool | None = None
    platforms: dict[str, bool] | None = None
    record_all: bool | None = None
    excluded_clients: list[str] | None = None


class LoginBody(BaseModel):
    token: str


class JobMeta(BaseModel):
    platform: Platform
    external_job_id: str
    url: str
    title: str | None = None
    client: str | None = None
    budget: str | None = None
    deadline: str | None = None
    application_count: int | None = None
    category: str | None = None
    detected_at: datetime | None = None
    source_id: str | None = None


class JobIngestItem(JobMeta):
    pass


class JobIngestRequest(BaseModel):
    jobs: list[JobIngestItem] = Field(default_factory=list)
    source_id: str | None = None
    actor: str | None = None
