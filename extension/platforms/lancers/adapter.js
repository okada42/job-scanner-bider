const APPLY_LABELS = ["提案する", "応募", "この仕事に提案"];
const FINAL_LABELS = ["提案を送信", "送信する", "この内容で提案"];

function visible(el) {
  if (!el) return false;
  const s = getComputedStyle(el);
  return s.display !== "none" && s.visibility !== "hidden" && el.offsetParent !== null;
}

function visibleButtons() {
  return [...document.querySelectorAll("a, button, input[type=submit]")].filter(visible);
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

function headingSection(title) {
  const heads = [...document.querySelectorAll("h1, h2, h3, h4, dt, th, .heading, [class*='Title'], [class*='heading']")];
  const head = heads.find((el) => (el.innerText || "").replace(/\s+/g, "").includes(title.replace(/\s+/g, "")));
  if (!head) return null;
  return head.closest("section, article, dl, table, .section, [class*='section']") || head.parentElement;
}

function sectionText(title) {
  const section = headingSection(title);
  const raw = (section?.innerText || "").trim();
  return raw.replace(new RegExp(`^${title}\\s*`), "").trim();
}

function labeledValue(labels) {
  const blob = document.body ? document.body.innerText : "";
  for (const label of labels) {
    const re = new RegExp(`${label}\\s*[:：]?\\s*([^\\n]{1,80})`);
    const m = blob.match(re);
    if (m && m[1]) return m[1].replace(/\s+/g, " ").trim();
  }
  return "";
}

function extractTitle() {
  const h1 = document.querySelector("h1");
  if (h1) {
    const clone = h1.cloneNode(true);
    clone.querySelectorAll("a, .subtitle, small").forEach((n) => n.remove());
    const text = (clone.innerText || h1.innerText || "").replace(/\s+/g, " ").trim();
    if (text) return text.replace(/\s*[-|｜].*$/, "").trim();
  }
  return (document.title || "").replace(/\s*[-|｜].*$/, "").trim();
}

function extractDetails() {
  for (const title of ["依頼概要", "仕事の詳細", "仕事内容", "募集内容", "見積もり募集の内容"]) {
    const text = sectionText(title);
    if (text && text.length > 20) return text;
  }
  const main = document.querySelector("main, article, [class*='work-detail'], [class*='WorkDetail']");
  return (main?.innerText || "").trim();
}

function extractClient() {
  const fromLabel = labeledValue(["依頼主", "クライアント", "発注者"]);
  if (fromLabel && !/業種|予算/.test(fromLabel) && fromLabel.length <= 40) return fromLabel;
  const link = document.querySelector(
    "a[href*='/client/'], a[href*='/user/'], a[href*='/profile/'], [class*='client'] a, [class*='Client'] a"
  );
  const name = (link?.innerText || "").replace(/\s+/g, " ").trim();
  if (name && name.length <= 40 && !/ログイン|会員|提案/.test(name)) return name;
  const box = document.querySelector("[class*='client'], [class*='Client'], [class*='employer']");
  const boxName = (box?.querySelector("a, .name, [class*='name']")?.innerText || "").replace(/\s+/g, " ").trim();
  if (boxName && boxName.length <= 40) return boxName;
  return "";
}

function extractBudget() {
  return labeledValue(["提示した予算", "予算", "報酬", "希望金額"]) || "";
}

function extractPosted() {
  return labeledValue(["掲載日", "募集開始", "掲載"]) || "";
}

function extractDeadline() {
  return labeledValue(["締切", "募集期間", "提案期限"]) || "";
}

function extractPage() {
  const postedLabel = extractPosted();
  const dates = globalThis.JobBiderDates;
  const postedAt = (dates && dates.parseJpDate && dates.parseJpDate(postedLabel)) || null;
  const title = extractTitle();
  const details = extractDetails();
  const client = extractClient();
  const budget = extractBudget();
  return {
    title,
    details,
    description: details,
    client: client || "—",
    budget,
    postedLabel,
    postedAt,
    deadline: extractDeadline(),
    identity: /本人確認/.test(document.body?.innerText || "") ? true : null,
    url: location.href,
    at: new Date().toISOString(),
  };
}

function extractLoggedInUser() {
  const sels = [
    "[data-user-name]",
    ".c-header__user-name",
    ".header-user-name",
    "[class*='header'] [class*='user-name']",
    "[class*='Header'] [class*='UserName']",
    "[class*='userName']",
    "header [class*='nickname']",
  ];
  for (const sel of sels) {
    const el = document.querySelector(sel);
    const text = (el?.innerText || el?.getAttribute("data-user-name") || "").replace(/\s+/g, " ").trim();
    if (text && text.length <= 40 && !/login|会員|ログイン|マイページ/i.test(text)) return text;
  }
  return "";
}

function isLoggedOut() {
  const name = extractLoggedInUser();
  if (name) return false;
  const login = visibleButtons().find((el) => {
    const t = labelOf(el);
    return t === "ログイン" || t.startsWith("ログイン") || t === "会員登録" || t.startsWith("会員登録");
  });
  return Boolean(login);
}

function isProposalPage() {
  if (/propose_start|proposal|offer|entry/.test(location.pathname)) return true;
  return Boolean(findProposalBox() && !findApplyControl());
}

function extractDescription() {
  return extractDetails() || (document.body?.innerText || "").trim();
}

window.JobBiderPlatform = {
  name: "lancers",
  findApplyControl,
  findProposalBox,
  extractDescription,
  extractPage,
  extractLoggedInUser,
  isLoggedOut,
  isProposalPage,
};
