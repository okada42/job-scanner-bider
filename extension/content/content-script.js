chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  const platform = window.JobBiderPlatform;
  if (!platform) {
    sendResponse({ ok: false, error: "no_platform" });
    return;
  }

  (async () => {
    if (msg.type === "EXTRACT") {
      sendResponse({
        ok: true,
        description: platform.extractDescription(),
        title: document.title,
        url: location.href,
        isProposalPage: platform.isProposalPage(),
      });
      return;
    }

    if (msg.type === "PREPARE") {
      const apply = platform.findApplyControl();
      const box = platform.findProposalBox();
      const description = platform.extractDescription();

      if (box && (platform.isProposalPage() || !apply)) {
        box.focus();
        box.value = description;
        box.dispatchEvent(new Event("input", { bubbles: true }));
        sendResponse({ ok: true, stage: "pasted", stopped: true });
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
