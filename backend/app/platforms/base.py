from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field


@dataclass
class ExtractedJob:
    platform: str
    external_job_id: str
    url: str
    title: str | None = None
    client: str | None = None
    budget: str | None = None
    deadline: str | None = None
    application_count: int | None = None
    category: str | None = None
    extra: dict = field(default_factory=dict)


class PlatformAdapter(ABC):
    name: str
    hosts: tuple[str, ...]

    @abstractmethod
    def parse_listing(self, html: str, page_url: str) -> list[ExtractedJob]:
        ...
