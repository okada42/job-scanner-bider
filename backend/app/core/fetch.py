import logging

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"
)

log = logging.getLogger("jobscanner.fetch")


async def fetch_html(url: str) -> str:
    import httpx

    headers = {
        "User-Agent": USER_AGENT,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "ja,en-US;q=0.9,en;q=0.8",
    }
    log.info("GET %s", url)
    async with httpx.AsyncClient(follow_redirects=True, timeout=25.0, headers=headers) as client:
        res = await client.get(url)
        log.info("GET %s -> %s bytes=%s final=%s", url, res.status_code, len(res.text), res.url)
        if res.status_code >= 400:
            log.warning("GET %s body_prefix=%s", url, res.text[:240].replace("\n", " "))
        res.raise_for_status()
        return res.text
