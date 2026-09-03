const APPLY_LABELS = ["提案する", "応募", "この仕事に提案"];
const FINAL_LABELS = ["提案を送信", "送信する", "この内容で提案"];

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
  return buttons.find((el) => {
    const t = labelOf(el);
    return APPLY_LABELS.some((l) => t.includes(l)) && !FINAL_LABELS.some((f) => t.includes(f));
  });
}

function findProposalBox() {
  const areas = [...document.querySelectorAll("textarea")].filter((el) => el.offsetParent !== null);
  return areas.sort((a, b) => (b.offsetHeight || 0) - (a.offsetHeight || 0))[0] || null;
}

function extractDescription() {
  const el = document.querySelector("main, article, [class*='work'], [class*='detail']");
  return (el?.innerText || document.body.innerText || "").trim();
}

window.JobBiderPlatform = {
  name: "lancers",
  findApplyControl,
  findProposalBox,
  extractDescription,
  extractLoggedInUser() {
    const el =
      document.querySelector("[data-user-name], .c-header__user-name, .header-user-name, a[href*='/mypage']");
    return (el?.innerText || el?.getAttribute("data-user-name") || "").replace(/\s+/g, " ").trim();
  },
  isProposalPage() {
    return /proposal|offer|entry/.test(location.pathname) || Boolean(findProposalBox() && document.querySelector("textarea"));
  },
};
