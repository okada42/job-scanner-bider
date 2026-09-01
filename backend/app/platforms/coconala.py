import re
from urllib.parse import urljoin

from app.platforms.base import PlatformAdapter


class CoconalaAdapter(PlatformAdapter):
    platform = "coconala"
    host_needles = ("coconala.com",)
    job_href = re.compile(r"/requests/(\d+)")

    def job_url(self, job_id: str, href: str) -> str:
        if href.startswith("http"):
            return href.split("?")[0]
        return urljoin("https://coconala.com", f"/requests/{job_id}")
