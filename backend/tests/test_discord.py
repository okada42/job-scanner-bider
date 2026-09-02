from app.integrations.discord import build_new_job_payload, job_post_url


def test_crowdworks_embed_uses_red_and_web_bracket():
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
        }
    )
    embed = payload["embeds"][0]
    assert embed["color"] == 0xE53935
    assert embed["title"].startswith("🔔[Crowdworks_Web]")
    assert "(image)" in embed["title"]
    assert payload["content"] == "https://crowdworks.jp/public/jobs/13424135"
    assert "`https://crowdworks.jp/public/jobs/13424135`" in embed["description"]
    assert embed["fields"][0]["value"] == "`https://crowdworks.jp/public/jobs/13424135`"
    assert "🔴 discuss · PTK53" in embed["description"]
    assert "Judgment ✅可" in embed["description"]
    assert "💰 ¥5,000" in embed["description"]
    assert "Create 21 gray background" in embed["description"]
    assert embed["footer"]["text"] == "CrowdWorks New Job Notification"


def test_lancers_and_coconala_use_platform_colors():
    lancers = build_new_job_payload(
        {
            "platform": "lancers",
            "title": "記事作成",
            "client": "Studio",
            "budget": "20000円",
            "url": "https://www.lancers.jp/work/detail/1",
        }
    )["embeds"][0]
    coco = build_new_job_payload(
        {
            "platform": "coconala",
            "title": "デザイン依頼",
            "client": "Client",
            "budget": "8000円",
            "url": "https://coconala.com/requests/1",
        }
    )["embeds"][0]
    assert lancers["color"] == 0x1E88E5
    assert lancers["title"].startswith("🔔[Lancers]")
    assert "🔵" in lancers["description"]
    assert lancers["footer"]["text"] == "Lancers New Job Notification"
    assert coco["color"] == 0x00C853
    assert coco["title"].startswith("🔔[Coconala]")
    assert "🟢" in coco["description"]


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
