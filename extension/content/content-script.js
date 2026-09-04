function showToast(text) {
  const msg = String(text || "").trim();
  if (!msg) return;
  let el = document.getElementById("jsb-toast");
  if (!el) {
    el = document.createElement("div");
    el.id = "jsb-toast";
    el.setAttribute("role", "status");
    el.style.cssText =
      "position:fixed;top:16px;right:16px;z-index:2147483647;max-width:320px;background:#111827;color:#fff;padding:12px 16px;border-radius:10px;font:14px/1.4 sans-serif;box-shadow:0 10px 30px rgba(0,0,0,.35)";
    (document.body || document.documentElement).appendChild(el);
  }
  el.textContent = msg;
  el.style.display = "block";
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => {
    el.style.display = "none";
  }, 7000);
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  const platform = window.JobBiderPlatform;
  if (msg.type === "SHOW_TOAST") {
    showToast(msg.text);
    sendResponse({ ok: true });
    return;
  }
  if (!platform) {
    sendResponse({ ok: false, error: "no_platform" });
    return;
  }

  (async () => {
    if (msg.type === "EXTRACT") {
      const extract = typeof platform.extractPage === "function" ? platform.extractPage() : null;
      sendResponse({
        ok: true,
        extract,
        description: extract?.details || platform.extractDescription(),
        title: extract?.title || document.title,
        url: location.href,
        isProposalPage: platform.isProposalPage(),
      });
      return;
    }

    if (msg.type === "PREPARE" || msg.type === "AUTO_APPLY") {
      if (typeof platform.prepare === "function") {
        const result = await platform.prepare(msg);
        if (result?.error === "not_logged_in") {
          showToast("CrowdWorksにログインしてください");
          chrome.runtime.sendMessage({ type: "LOGIN_MISSING" });
        }
        sendResponse(result);
        return;
      }
      const apply = platform.findApplyControl();
      const box = platform.findProposalBox();
      const description = platform.extractDescription();
      if (box && (platform.isProposalPage() || !apply)) {
        box.focus();
        box.value = description;
        box.dispatchEvent(new Event("input", { bubbles: true }));
        sendResponse({ ok: true, stage: "pasted", stopped: true, description });
        return;
      }
      if (apply) {
        apply.click();
        sendResponse({ ok: true, stage: "clicked_apply", stopped: false, description });
        return;
      }
      sendResponse({ ok: false, error: "no_apply_or_box", stopped: true });
    }
  })();

  return true;
});

(function watchUserApply() {
  const FINAL = /送信する|提出する|応募を送信|この内容で応募|^応募する$/;
  document.addEventListener(
    "click",
    (event) => {
      const el = event.target && event.target.closest ? event.target.closest("a, button, input") : null;
      if (!el) return;
      const label = (el.innerText || el.value || el.getAttribute("aria-label") || "").replace(/\s+/g, " ").trim();
      if (!FINAL.test(label)) return;
      chrome.runtime.sendMessage({ type: "APPLY_FINISHED" });
    },
    true
  );
})();

(function reportExtract() {
  const platform = window.JobBiderPlatform;
  if (!platform) return;

  function reportUser(tries) {
    try {
      if (typeof platform.extractLoggedInUser !== "function") return;
      const name = platform.extractLoggedInUser();
      if (name) {
        chrome.runtime.sendMessage({ type: "PROFILE_USER", name, platform: platform.name });
        return;
      }
    } catch (_) {
      /* ignore */
    }
    if (tries > 0) {
      setTimeout(() => reportUser(tries - 1), 700);
      return;
    }
    if (platform.name === "crowdworks") chrome.runtime.sendMessage({ type: "LOGIN_MISSING" });
  }
  reportUser(5);
  if (typeof platform.extractPage !== "function") return;
  if (platform.isProposalPage && platform.isProposalPage()) return;
  try {
    const extract = platform.extractPage();
    if (extract && (extract.client || extract.details)) {
      chrome.runtime.sendMessage({ type: "PAGE_EXTRACT", extract });
    }
  } catch (_) {
    /* ignore */
  }
})();
