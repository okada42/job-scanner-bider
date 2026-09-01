const APPLY_LABELS = ["応募", "この仕事に応募", "応募する"];
const FINAL_LABELS = ["送信する", "提出する", "応募を送信", "この内容で応募"];

function visibleButtons() {
  return [...document.querySelectorAll("a, button, input[type=submit]")].filter((el) => {
    const s = getComputedStyle(el);
    return s.display !== "none" && s.visibility !== "hidden";
  });
}

function labelOf(el) {
  return (el.innerText || el.value || el.getAttribute("aria-label") || "").replace(/\s+/g, " ").trim();
}

function findApplyControl() {
  const buttons = visibleButtons();
  return buttons.find((el) => APPLY_LABELS.some((l) => labelOf(el).includes(l) && !FINAL_LABELS.some((f) => labelOf(el).includes(f))));
}

function findProposalBox() {
  const areas = [...document.querySelectorAll("textarea")].filter((el) => el.offsetParent !== null);
  if (!areas.length) return null;
  return areas.sort((a, b) => (b.offsetHeight || 0) - (a.offsetHeight || 0))[0];
}

function extractDescription() {
  const selectors = [
    "[class*='job-offer']",
    "[class*='description']",
    "[class*='detail']",
    "article",
    "main",
  ];
  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (el && (el.innerText || "").length > 80) return el.innerText.trim();
  }
  return (document.body.innerText || "").slice(0, 20000);
}

window.JobBiderPlatform = {
  name: "crowdworks",
  findApplyControl,
  findProposalBox,
  extractDescription,
  isProposalPage() {
    return /offers|entries|proposals|応募/.test(location.pathname + location.search) || Boolean(findProposalBox() && !findApplyControl());
  },
};
