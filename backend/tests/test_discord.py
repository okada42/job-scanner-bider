from app.integrations.discord import build_new_job_payload, is_hourly_job, job_post_url, posted_label


def test_crowdworks_embed_clickable_title_copyable_url_and_here():
    payload = build_new_job_payload(
        {
            "platform": "crowdworks",
            "title": "仮画像素材21点の作成（グレー背景・指定テキスト入り）",
            "client": "PTK53",
            "budget": "5,000円",
            "deadline": "2099-09-16",
            "url": "https://crowdworks.jp/public/jobs/13424135",
            "category_id": 233,
            "source_url": "https://crowdworks.jp/public/jobs/search?category_id=230&order=new",
            "job_kind": "discuss",
            "description": "Create 21 gray background WebP temporary images.",
            "extra": {
                "verified": False,
                "login_required": False,
                "posted_at": "2026-09-03T10:37:51+09:00",
            },
        }
    )
    embed = payload["embeds"][0]
    assert payload["content"] == "@here"
    assert payload["allowed_mentions"] == {"parse": ["everyone"]}
    assert embed["url"] == "https://crowdworks.jp/public/jobs/13424135"
    assert embed["color"] == 0x1E88E5
    assert embed["title"].startswith("🔔[Crowdworks_Web]")
    assert "(image)" in embed["title"]
    assert embed["description"].startswith("```\nhttps://crowdworks.jp/public/jobs/13424135\n```")
    assert embed["description"].count("https://crowdworks.jp/public/jobs/13424135") == 1
    assert "🔵 discuss · PTK53" in embed["description"]
    assert "Verification ❌未認定" in embed["description"]
    assert "📅 Posted 2026-09-03 10:37" in embed["description"]
    assert embed["timestamp"] == "2026-09-03T01:37:51Z"
    assert "Judgment ✅可" in embed["description"]
    assert "💰 ¥5,000" in embed["description"]
    assert "Hourly" not in embed["description"]
    assert "Create 21 gray background" not in embed["description"]
    assert embed["footer"]["text"] == "CrowdWorks New Job Notification"


def test_lancers_blue_and_coconala_yellow():
    lancers = build_new_job_payload(
        {
            "platform": "lancers",
            "title": "記事作成",
            "client": "Studio",
            "budget": "20000円",
            "url": "https://www.lancers.jp/work/detail/1",
        }
    )
    coco = build_new_job_payload(
        {
            "platform": "coconala",
            "title": "デザイン依頼",
            "client": "Client",
            "budget": "8000円",
            "url": "https://coconala.com/requests/1",
            "extra": {"verified": True},
        }
    )
    assert lancers["content"] == "@here"
    assert lancers["embeds"][0]["color"] == 0x1E88E5
    assert lancers["embeds"][0]["url"] == "https://www.lancers.jp/work/detail/1"
    assert "🔵" in lancers["embeds"][0]["description"]
    assert coco["embeds"][0]["color"] == 0xFDD835
    assert "🟡" in coco["embeds"][0]["description"]
    assert "Verification ✅認定" in coco["embeds"][0]["description"]


def test_hourly_job_is_marked():
    embed = build_new_job_payload(
        {
            "platform": "crowdworks",
            "title": "データ入力",
            "client": "Acme",
            "budget": "1,500円",
            "url": "https://crowdworks.jp/public/jobs/9",
            "extra": {"hourly": True},
        }
    )["embeds"][0]
    assert "Hourly 時給" in embed["description"]
    assert "💰 時給 ¥1,500" in embed["description"]
    assert is_hourly_job({"title": "【時給】ライター"}, {}) is True


def test_job_post_url_is_canonical_without_query():
    assert (
        job_post_url(
            {
                "platform": "crowdworks",
                "external_job_id": "13424135",
                "url": "https://crowdworks.jp/public/jobs/13424135?ref=list",
            }
        )
        == "https://crowdworks.jp/public/jobs/13424135"
    )


def test_posted_time_falls_back_to_detected_at():
    embed = build_new_job_payload(
        {
            "platform": "lancers",
            "title": "記事作成",
            "url": "https://www.lancers.jp/work/detail/1",
            "detected_at": "2026-09-03T01:37:51+00:00",
        }
    )["embeds"][0]
    assert "📅 Posted 2026-09-03 10:37" in embed["description"]
    assert embed["timestamp"] == "2026-09-03T01:37:51Z"


def test_posted_label_reads_japanese_listing_title():
    assert (
        posted_label(
            {},
            {"posted_at": "2026年9月3日 木曜日 08:16"},
        )
        == "📅 Posted 2026-09-03 08:16"
    )


def test_certified_client_shows_verified():
    embed = build_new_job_payload(
        {
            "platform": "crowdworks",
            "title": "案件",
            "client": "Acme",
            "url": "https://crowdworks.jp/public/jobs/1",
            "extra": {"is_employer_certification": True},
        }
    )["embeds"][0]
    assert "Verification ✅認定" in embed["description"]
