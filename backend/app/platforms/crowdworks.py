import re
from urllib.parse import urljoin

from app.platforms.base import PlatformAdapter


class CrowdWorksAdapter(PlatformAdapter):
    platform = "crowdworks"
    host_needles = ("crowdworks.jp",)
    job_href = re.compile(r"/public/jobs/(\d+)")

    def job_url(self, job_id: str, href: str) -> str:
        if href.startswith("http"):
            return href.split("?")[0]
        return urljoin("https://crowdworks.jp", f"/public/jobs/{job_id}")
