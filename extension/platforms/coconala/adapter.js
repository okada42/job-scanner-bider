const APPLY_LABELS = ["応募", "提案する", "この募集に応募"];
const FINAL_LABELS = ["送信する", "応募を確定", "この内容で応募"];

function visibleButtons() {
  return [...document.querySelectorAll("a, button, input[type=submit]")].filter((el) => {
    const s = getComputedStyle(el);
    return s.display !== "none" && s.visibility !== "hidden";
  });
}

function labelOf(el) {
  return (el.innerText || el.value || "").replace(/\s+/g, " ").trim();
}

function findApplyControl() {
  return visibleButtons().find((el) => {
    const t = labelOf(el);
    return APPLY_LABELS.some((l) => t.includes(l)) && !FINAL_LABELS.some((f) => t.includes(f));
  });
}

function findProposalBox() {
  const areas = [...document.querySelectorAll("textarea")].filter((el) => el.offsetParent !== null);
  return areas.sort((a, b) => (b.offsetHeight || 0) - (a.offsetHeight || 0))[0] || null;
}

window.JobBiderPlatform = {
  name: "coconala",
  findApplyControl,
  findProposalBox,
  extractDescription() {
    const el = document.querySelector("main, article, [class*='request']");
    return (el?.innerText || document.body.innerText || "").trim();
  },
  isProposalPage() {
    return /offer|apply|proposal|entries/.test(location.pathname);
  },
};
