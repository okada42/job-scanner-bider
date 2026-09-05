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
    if (msg.type === "PREPARE" || msg.type === "AUTO_APPLY") {
      if (platform.name === "lancers" && typeof platform.isLoggedOut === "function" && platform.isLoggedOut()) {
        showToast("Lancersにログインしてください");
        chrome.runtime.sendMessage({ type: "LANCERS_LOGGED_OUT" });
        sendResponse({ ok: false, error: "not_logged_in", stopped: true });
        return;
      }
      if (typeof platform.prepare === "function") {
        sendResponse(await platform.prepare(msg));
        return;
      }
      // Generic platform: click the apply control, or clear the proposal box. Nothing is read.
      const apply = platform.findApplyControl();
      const box = platform.findProposalBox();
      if (box && (platform.isProposalPage() || !apply)) {
        box.focus();
        box.value = "";
        box.dispatchEvent(new Event("input", { bubbles: true }));
        sendResponse({ ok: true, stage: "cleared", stopped: true });
        return;
      }
      if (apply) {
        apply.click();
        sendResponse({ ok: true, stage: "clicked_apply", stopped: false });
        return;
      }
      sendResponse({ ok: false, error: "no_apply_or_box", stopped: true });
    }
  })();

  return true;
});

(function watchUserApply() {
  const FINAL = /送信する|提出する|応募を送信|この内容で応募|^応募する$|提案を送信|この内容で提案/;
  document.addEventListener(
    "click",
    (event) => {
      // Only a real user click counts as "sent"; clicks the adapters dispatch are untrusted.
      if (!event.isTrusted) return;
      const el = event.target && event.target.closest ? event.target.closest("a, button, input") : null;
      if (!el) return;
      const label = (el.innerText || el.value || el.getAttribute("aria-label") || "").replace(/\s+/g, " ").trim();
      if (!FINAL.test(label)) return;
      chrome.runtime.sendMessage({ type: "APPLY_FINISHED" });
    },
    true
  );
})();

(function reportSessionOnLoad() {
  const platform = window.JobBiderPlatform;
  if (!platform) return;

  // Lancers: the header renders after load, so re-check a few times before calling it logged out.
  function reportSession(tries) {
    if (platform.name !== "lancers" || typeof platform.isLoggedOut !== "function") return;
    try {
      if (!platform.isLoggedOut()) return;
    } catch (_) {
      return;
    }
    if (tries > 0) {
      setTimeout(() => reportSession(tries - 1), 250);
      return;
    }
    chrome.runtime.sendMessage({ type: "LANCERS_LOGGED_OUT" });
  }
  reportSession(4);
})();
