import re
from urllib.parse import urljoin

from app.platforms.base import PlatformAdapter


class LancersAdapter(PlatformAdapter):
    platform = "lancers"
    host_needles = ("lancers.jp",)
    job_href = re.compile(r"/work/detail/(\d+)")

    def job_url(self, job_id: str, href: str) -> str:
        if href.startswith("http"):
            return href.split("?")[0]
        return urljoin("https://www.lancers.jp", f"/work/detail/{job_id}")
