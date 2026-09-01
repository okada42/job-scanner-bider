from dataclasses import dataclass, field
from datetime import datetime


@dataclass
class JobDraft:
    platform: str
    external_job_id: str
    url: str
    title: str | None = None
    client: str | None = None
    budget: str | None = None
    deadline: str | None = None
    application_count: int | None = None
    category: str | None = None
    detected_at: datetime = field(default_factory=datetime.utcnow)
