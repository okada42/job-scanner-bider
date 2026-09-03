chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  const platform = window.JobBiderPlatform;
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
        sendResponse(await platform.prepare(msg));
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
  try {
    if (typeof platform.extractLoggedInUser === "function") {
      const name = platform.extractLoggedInUser();
      if (name) chrome.runtime.sendMessage({ type: "PROFILE_USER", name, platform: platform.name });
    }
  } catch (_) {
    /* ignore */
  }
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
