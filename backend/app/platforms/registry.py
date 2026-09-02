from __future__ import annotations

import html as html_lib
import json
import logging
import re
from urllib.parse import urljoin, urlparse

from bs4 import BeautifulSoup

from app.platforms.base import ExtractedJob, PlatformAdapter
from app.platforms.categories import crowdworks_category

log = logging.getLogger("jobscanner.parse")


def absolute(base: str, href: str) -> str:
    return urljoin(base, href)


def load_next_data(html: str) -> dict | None:
    soup = BeautifulSoup(html, "lxml")
    tag = soup.find("script", id="__NEXT_DATA__")
    if not tag or not tag.string:
        return None
    try:
        return json.loads(tag.string)
    except json.JSONDecodeError:
        return None


def walk(obj):
    if isinstance(obj, dict):
        yield obj
        for v in obj.values():
            yield from walk(v)
    elif isinstance(obj, list):
        for item in obj:
            yield from walk(item)


def text(el) -> str | None:
    if not el:
        return None
    value = el.get_text(" ", strip=True)
    return value or None


def _cw_budget(payment: object) -> str | None:
    if not isinstance(payment, dict):
        return None
    fixed = payment.get("fixed_price_payment") or {}
    hourly = payment.get("hourly_payment") or {}
    if not isinstance(fixed, dict):
        fixed = {}
    if not isinstance(hourly, dict):
        hourly = {}
    mn = fixed.get("min_budget") or hourly.get("min_hourly_wage") or hourly.get("min_budget")
    mx = fixed.get("max_budget") or hourly.get("max_hourly_wage") or hourly.get("max_budget")

    def yen(value) -> str | None:
        if value is None or value == "":
            return None
        try:
            return f"{int(float(value)):,}円"
        except (TypeError, ValueError):
            return None

    parts = [p for p in (yen(mn), yen(mx)) if p]
    if not parts:
        return None
    if len(parts) == 2 and parts[0] != parts[1]:
        return f"{parts[0]}〜{parts[1]}"
    return parts[-1]


class CrowdWorksAdapter(PlatformAdapter):
    name = "crowdworks"
    hosts = ("crowdworks.jp", "www.crowdworks.jp")
    id_re = re.compile(r"/public/jobs/(\d+)")
    last_meta: dict = {}

    def parse_listing(self, html: str, page_url: str) -> list[ExtractedJob]:
        self.last_meta = {}
        jobs: dict[str, ExtractedJob] = {}
        soup = BeautifulSoup(html, "lxml")
        vue_n = self._parse_vue_container(soup, jobs, page_url)

        for a in soup.select("a[href*='/public/jobs/']"):
            href = a.get("href") or ""
            m = self.id_re.search(href)
            if not m:
                continue
            jid = m.group(1)
            url = absolute(page_url, href.split("?")[0])
            card = a.find_parent(["li", "article", "div"]) or a
            title = text(a) or text(card.select_one("h2, h3, .item_title"))
            client = text(card.select_one(".user-name, .client, [class*='client']"))
            budget = text(card.select_one(".payment, .amount, [class*='payment'], [class*='amount']"))
            deadline = text(card.select_one(".absolute_date, [class*='deadline'], [class*='date']"))
            apps = _apps(text(card))
            if jid in jobs:
                continue
            jobs[jid] = ExtractedJob(
                platform=self.name,
                external_job_id=jid,
                url=url,
                title=title if title and "jobs" not in title.lower() else title,
                client=client,
                budget=budget,
                deadline=deadline,
                application_count=apps,
            )

        data = load_next_data(html)
        if data:
            for node in walk(data):
                url = str(node.get("url") or node.get("job_url") or "")
                m = self.id_re.search(url)
                jid = m.group(1) if m else None
                if not jid:
                    maybe = str(node.get("id") or "")
                    if maybe.isdigit() and (node.get("title") or node.get("job_title")):
                        jid = maybe
                if not jid:
                    continue
                full = url if url.startswith("http") else f"https://crowdworks.jp/public/jobs/{jid}"
                prev = jobs.get(jid)
                jobs[jid] = ExtractedJob(
                    platform=self.name,
                    external_job_id=jid,
                    url=full.split("?")[0],
                    title=node.get("title") or node.get("job_title") or (prev.title if prev else None),
                    client=node.get("client_name") or node.get("user_name") or (prev.client if prev else None),
                    budget=str(node.get("payment") or node.get("budget") or "") or (prev.budget if prev else None),
                    deadline=str(node.get("deadline") or "") or (prev.deadline if prev else None),
                    application_count=_as_int(node.get("applications") or node.get("entry_count")),
                )
        log.info(
            "crowdworks parse url=%s vue=%s total=%s listing_total=%s",
            page_url,
            vue_n,
            len(jobs),
            (self.last_meta or {}).get("total_entries"),
        )
        meta = dict(self.last_meta or {})
        meta["parsed"] = len(jobs)
        self.last_meta = meta
        return list(jobs.values())

    def _parse_vue_container(self, soup: BeautifulSoup, jobs: dict[str, ExtractedJob], page_url: str) -> int:
        el = soup.find(id="vue-container")
        raw = el.get("data") if el else None
        if not raw:
            log.info("crowdworks no vue-container data url=%s", page_url)
            return 0
        payload = _load_json(raw)
        if not isinstance(payload, dict):
            log.warning("crowdworks vue-container JSON unusable url=%s type=%s", page_url, type(payload))
            return 0
        offers = _cw_offers(payload)
        before = len(jobs)
        for wrap in offers:
            if not isinstance(wrap, dict):
                continue
            offer = wrap.get("job_offer") if isinstance(wrap.get("job_offer"), dict) else wrap
            jid = offer.get("id")
            if not jid:
                continue
            jid = str(jid)
            client = wrap.get("client") if isinstance(wrap.get("client"), dict) else {}
            entry = wrap.get("entry") if isinstance(wrap.get("entry"), dict) else {}
            if entry.get("contest_entry") or entry.get("competition_entry"):
                kind = "contest"
            elif entry.get("task_entry"):
                kind = "task"
            else:
                kind = "discuss"
            category_id = offer.get("category_id")
            _, tag = crowdworks_category(category_id, page_url)
            jobs[jid] = ExtractedJob(
                platform=self.name,
                external_job_id=jid,
                url=f"https://crowdworks.jp/public/jobs/{jid}",
                title=offer.get("title"),
                client=client.get("username") or client.get("name"),
                budget=_cw_budget(wrap.get("payment") or offer.get("payment")),
                deadline=str(offer.get("expired_on") or offer.get("deadline") or "") or None,
                category=str(category_id) if category_id else tag,
                extra={
                    "description": offer.get("description_digest"),
                    "category_id": category_id,
                    "login_required": bool(offer.get("is_login_required")),
                    "job_kind": kind,
                    "tag": tag,
                },
            )
        added = len(jobs) - before
        log.info("crowdworks vue-container offers=%s added=%s url=%s", len(offers), added, page_url)
        result = payload.get("searchResult") if isinstance(payload.get("searchResult"), dict) else {}
        paging = result.get("page") if isinstance(result.get("page"), dict) else {}
        self.last_meta = {
            "parsed": added,
            "total_entries": _as_int(paging.get("total_entries")),
            "page_size": _as_int(paging.get("size")),
            "current_page": _as_int(paging.get("current_page")),
            "total_page": _as_int(paging.get("total_page")),
        }
        return added


class LancersAdapter(PlatformAdapter):
    name = "lancers"
    hosts = ("lancers.jp", "www.lancers.jp")
    id_re = re.compile(r"/work/detail/(\d+)")

    def parse_listing(self, html: str, page_url: str) -> list[ExtractedJob]:
        jobs: dict[str, ExtractedJob] = {}
        soup = BeautifulSoup(html, "lxml")
        for a in soup.select("a[href*='/work/detail/']"):
            href = a.get("href") or ""
            m = self.id_re.search(href)
            if not m:
                continue
            jid = m.group(1)
            card = a.find_parent(["li", "article", "div"]) or a
            jobs[jid] = ExtractedJob(
                platform=self.name,
                external_job_id=jid,
                url=absolute(page_url, href.split("?")[0]),
                title=text(a),
                client=text(card.select_one("[class*='client'], [class*='user']")),
                budget=text(card.select_one("[class*='price'], [class*='reward'], [class*='budget']"))
                or _first_yen(text(card)),
                deadline=text(card.select_one("[class*='limit'], [class*='remain']")),
                application_count=_apps(text(card)),
            )
        data = load_next_data(html)
        if data:
            for node in walk(data):
                url = str(node.get("url") or node.get("work_url") or node.get("permalink") or "")
                m = self.id_re.search(url) or self.id_re.search(str(node.get("id") or ""))
                jid = None
                if m:
                    jid = m.group(1)
                elif str(node.get("id", "")).isdigit() and node.get("title"):
                    jid = str(node["id"])
                if not jid:
                    continue
                jobs[jid] = ExtractedJob(
                    platform=self.name,
                    external_job_id=jid,
                    url=url if url.startswith("http") else f"https://www.lancers.jp/work/detail/{jid}",
                    title=node.get("title") or node.get("name"),
                    client=(node.get("client") or {}).get("name") if isinstance(node.get("client"), dict) else node.get("client_name"),
                    budget=str(node.get("price") or node.get("budget") or node.get("reward") or "") or None,
                    deadline=str(node.get("ended_at") or node.get("deadline") or "") or None,
                    application_count=_as_int(node.get("proposal_count") or node.get("proposals")),
                )
        log.info("lancers parse url=%s total=%s", page_url, len(jobs))
        return list(jobs.values())


class CoconalaAdapter(PlatformAdapter):
    name = "coconala"
    hosts = ("coconala.com", "www.coconala.com", "jobmatching-web.coconala.com")
    id_re = re.compile(r"/requests/(\d+)")

    def parse_listing(self, html: str, page_url: str) -> list[ExtractedJob]:
        jobs: dict[str, ExtractedJob] = {}
        soup = BeautifulSoup(html, "lxml")
        for a in soup.select("a[href*='/requests/']"):
            href = a.get("href") or ""
            m = self.id_re.search(href)
            if not m:
                continue
            jid = m.group(1)
            card = a.find_parent(["li", "article", "div"]) or a
            jobs[jid] = ExtractedJob(
                platform=self.name,
                external_job_id=jid,
                url=absolute(page_url, href.split("?")[0]),
                title=text(a),
                client=text(card.select_one("[class*='user'], [class*='client']")),
                budget=_first_yen(text(card)),
                deadline=text(card.select_one("[class*='limit'], [class*='date']")),
                application_count=_apps(text(card)),
            )
        data = load_next_data(html)
        if data:
            for node in walk(data):
                url = str(node.get("url") or node.get("request_url") or "")
                m = self.id_re.search(url)
                jid = m.group(1) if m else None
                if not jid and str(node.get("id", "")).isdigit() and (node.get("title") or node.get("name")):
                    jid = str(node["id"])
                if not jid:
                    continue
                jobs[jid] = ExtractedJob(
                    platform=self.name,
                    external_job_id=jid,
                    url=url if url.startswith("http") else f"https://coconala.com/requests/{jid}",
                    title=node.get("title") or node.get("name"),
                    client=node.get("user_name") or node.get("client_name"),
                    budget=str(node.get("budget") or node.get("price") or "") or None,
                    deadline=str(node.get("expire_date") or node.get("deadline") or "") or None,
                    application_count=_as_int(node.get("proposal_count") or node.get("offers_count")),
                )
        log.info("coconala parse url=%s total=%s", page_url, len(jobs))
        return list(jobs.values())


def _load_json(raw: str):
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        try:
            return json.loads(html_lib.unescape(raw))
        except json.JSONDecodeError as exc:
            log.warning("JSON decode failed: %s prefix=%s", exc, raw[:180].replace("\n", " "))
            return None


def _cw_offers(payload: dict) -> list:
    result = payload.get("searchResult")
    if isinstance(result, dict):
        offers = result.get("job_offers")
        if isinstance(offers, list):
            return offers
    for node in walk(payload):
        offers = node.get("job_offers")
        if isinstance(offers, list) and offers:
            return offers
    return []


def _as_int(value) -> int | None:
    if value is None or value == "":
        return None
    try:
        return int(re.sub(r"[^\d]", "", str(value)) or 0) or int(value)
    except (TypeError, ValueError):
        return None


def _apps(blob: str | None) -> int | None:
    if not blob:
        return None
    m = re.search(r"(応募|提案|募集)\s*[:：]?\s*(\d+)", blob)
    if m:
        return int(m.group(2))
    return None


def _first_yen(blob: str | None) -> str | None:
    if not blob:
        return None
    m = re.search(r"((?:\d{1,3}(?:,\d{3})+|\d+)\s*(?:円)?\s*(?:[~〜\-–]|から)?\s*(?:\d{1,3}(?:,\d{3})+|\d+)?\s*円)", blob)
    return m.group(1) if m else None


def detect_platform(url: str) -> str | None:
    host = urlparse(url).hostname or ""
    host = host.lower()
    for adapter in ADAPTERS.values():
        if any(host == h or host.endswith("." + h) for h in adapter.hosts):
            return adapter.name
    return None


ADAPTERS: dict[str, PlatformAdapter] = {
    "crowdworks": CrowdWorksAdapter(),
    "lancers": LancersAdapter(),
    "coconala": CoconalaAdapter(),
}
