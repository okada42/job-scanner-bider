const APPLY_LABELS = ["提案する", "この仕事に提案"];
const FINAL_LABELS = ["提案を送信", "送信する", "この内容で提案", "確認画面へ", "この内容で送信"];
const DETAIL_SUB_RE = /続きを読む|詳細を書く|^詳細$|もっと見る|折りたたむ/;

function visible(el) {
  if (!el) return false;
  const s = getComputedStyle(el);
  return s.display !== "none" && s.visibility !== "hidden" && el.offsetParent !== null;
}

function visibleButtons() {
  return [...document.querySelectorAll("a, button, input[type=submit], input[type=button]")].filter(visible);
}

function labelOf(el) {
  return (el.innerText || el.value || el.getAttribute("aria-label") || "").replace(/\s+/g, " ").trim();
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function randomWait() {
  return sleep(300 + Math.floor(Math.random() * 400));
}

function compact(text) {
  return String(text || "").replace(/\s+/g, "");
}

function looksLikePrice(el) {
  if (!el) return false;
  const row = el.closest("tr, li, label, .form-item, .form-group, .field");
  const blob = [
    el.name,
    el.id,
    el.placeholder,
    el.getAttribute("aria-label"),
    (row?.innerText || "").slice(0, 80),
  ].join(" ");
  if (/完了予定日|提案文|見積もり|自己PR|タイトル/.test(blob)) return false;
  return /契約金額|希望金額|提示金額|報酬|単価|price|budget|reward|contract_amount|payment_amount/i.test(blob);
}

function pasteInto(el, text) {
  if (!el) return false;
  el.focus();
  const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  if (setter) setter.call(el, text);
  else el.value = text;
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
  el.dispatchEvent(new Event("blur", { bubbles: true }));
  return true;
}

function findLabelNode(title) {
  const want = compact(title);
  const nodes = [...document.querySelectorAll("label, th, dt, h2, h3, h4, legend, .label, [class*='label']")];
  return (
    nodes.find((el) => {
      const t = compact(el.innerText);
      return t === want || t.startsWith(want);
    }) || null
  );
}

function labeledCell(title) {
  const head = findLabelNode(title);
  if (!head) return "";
  const row = head.closest("tr, dl, li, .form-item, .row");
  const value = (row && row.querySelector("td, dd")) || head.nextElementSibling;
  return (value?.innerText || "").replace(/\s+/g, " ").trim();
}

function findLabeledControl(titles, selector) {
  for (const title of titles) {
    const label = findLabelNode(title);
    if (!label) continue;
    if (label.control && label.control.matches(selector) && visible(label.control) && !looksLikePrice(label.control)) {
      return label.control;
    }
    let sib = label.nextElementSibling;
    for (let i = 0; i < 6 && sib; i += 1, sib = sib.nextElementSibling) {
      const hit = sib.matches?.(selector) ? sib : sib.querySelector?.(selector);
      if (hit && visible(hit) && !looksLikePrice(hit)) return hit;
    }
    const scope = label.closest("tr, li, .form-group, .field, .form-item, section, dl, div") || label.parentElement;
    const hit = [...(scope || document).querySelectorAll(selector)].find((el) => visible(el) && !looksLikePrice(el));
    if (hit) return hit;
  }
  return null;
}

function isDetailSubButton(el) {
  if (!el) return false;
  const t = labelOf(el);
  if (DETAIL_SUB_RE.test(t)) return true;
  const row = el.closest("tr, dl, li, .form-item, .row");
  const head = compact((row && (row.querySelector("th, dt, .label")?.innerText || "")) || "");
  return head === "詳細" || head.startsWith("詳細");
}

function safeClick(el) {
  if (!el || isDetailSubButton(el) || FINAL_LABELS.some((f) => labelOf(el).includes(f))) return false;
  el.click();
  return true;
}

function findApplyControl() {
  if (isProposalPath()) return null;
  const buttons = visibleButtons().filter((el) => !isDetailSubButton(el));
  const exact = buttons.find((el) => {
    const t = labelOf(el);
    return (t === "提案する" || t.startsWith("提案する")) && !FINAL_LABELS.some((f) => t.includes(f));
  });
  if (exact) return exact;
  return buttons.find((el) => {
    const t = labelOf(el);
    return APPLY_LABELS.some((l) => t.includes(l)) && !FINAL_LABELS.some((f) => t.includes(f));
  });
}

function findProposalBox() {
  return findLabeledControl(["提案文"], "textarea");
}

function clientBox() {
  return document.querySelector(".p-work-detail-client-box__inner, .p-work-detail-client-box");
}

function extractClient() {
  const box = clientBox();
  const nameEl = box?.querySelector(".client_name, .p-work-detail-client-box-work-status");
  const name = (nameEl?.innerText || "").replace(/\s+/g, " ").trim();
  if (name && name.length <= 60 && !/ログイン|会員|メッセージ/.test(name)) return name;
  const fromRow = labeledCell("クライアント名") || labeledCell("依頼主") || labeledCell("クライアント");
  if (fromRow && fromRow.length <= 60 && !/業種|予算|ログイン/.test(fromRow)) return fromRow;
  return "";
}

function extractClientMeta() {
  const box = clientBox();
  const blob = box ? box.innerText : "";
  const rate = blob.match(/発注率\s*(\d+\s*%)/) || blob.match(/(\d+)\s*%/);
  return {
    identity: /本人確認/.test(blob) ? true : null,
    completionRate: rate ? rate[1].replace(/\s+/g, "") : "—",
  };
}

function extractBudget() {
  const root = document.querySelector(".work_detail_lefter") || document.body;
  const text = root ? root.innerText : "";
  const project = text.match(/プロジェクト[\s\S]{0,40}[~～〜]\s*([\d,]+円)/) || text.match(/[~～〜]\s*([\d,]+円)/);
  if (project) return `~ ${project[1]}`;
  const fromRow = labeledCell("依頼予算") || labeledCell("提示した予算") || labeledCell("予算");
  return fromRow && /円/.test(fromRow) ? fromRow : "";
}

function extractPosted() {
  const blob = document.body ? document.body.innerText : "";
  const start = blob.match(/開始[：:\s]*(\d{4}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日)/);
  return start ? start[1] : labeledCell("募集開始日時") || labeledCell("募集開始") || labeledCell("掲載日") || "";
}

function extractDeadline() {
  const blob = document.body ? document.body.innerText : "";
  const due = blob.match(/締切[：:\s]*(\d{4}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日(?:\s*\d{1,2}:\d{2})?)/);
  return due ? due[1].replace(/\s+/g, " ").trim() : labeledCell("募集締切日時") || labeledCell("締切") || "";
}

function extractDesiredDue() {
  const blob = document.body ? document.body.innerText : "";
  const noki = blob.match(/希望納期[：:\s]*(\d{4}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日)/);
  return noki ? noki[1] : labeledCell("希望納期") || "";
}

function extractPage() {
  const dates = globalThis.JobBiderDates;
  const postedLabel = extractPosted();
  const desiredLabel = extractDesiredDue();
  const postedAt = dates && postedLabel ? dates.parseJpDate(postedLabel) : null;
  const dueAt =
    (dates && desiredLabel && dates.parseJpDate(desiredLabel)) ||
    (postedAt && dates ? dates.plusOneMonth(postedAt) : null);
  const meta = extractClientMeta();
  return {
    title: "",
    details: "",
    description: "",
    client: extractClient() || "—",
    budget: extractBudget(),
    postedLabel,
    postedAt,
    deadline: extractDeadline(),
    dueAt,
    identity: meta.identity,
    completionRate: meta.completionRate,
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

function isProposalPath() {
  return /propose_start|\/proposal|offer|entry/.test(location.pathname);
}

function isProposalPage() {
  if (isProposalPath()) return true;
  const blob = document.body ? document.body.innerText.slice(0, 6000) : "";
  if (/提案文/.test(blob) && /完了予定日/.test(blob)) return true;
  if (/完了予定日/.test(blob) && /契約金額/.test(blob) && !findApplyControl()) return true;
  return Boolean(findProposalBox() && !findApplyControl());
}

function extractDescription() {
  return "";
}

function dueParts(extract) {
  const dates = globalThis.JobBiderDates;
  if (!dates) return null;
  if (extract?.dueAt) return extract.dueAt;
  const desired = extractDesiredDue();
  if (desired) {
    const parsed = dates.parseJpDate(desired);
    if (parsed) return parsed;
  }
  if (extract?.postedAt) return dates.plusOneMonth(extract.postedAt);
  const today = dates.todayJst && dates.todayJst();
  const m = String(today || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return dates.plusOneMonth({ y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) });
}

function setSelectValue(select, num) {
  if (!select) return false;
  const want = String(num);
  const padded = want.padStart(2, "0");
  const opt = [...select.options].find((o) => {
    const v = String(o.value || "");
    const t = String(o.textContent || "").replace(/\s+/g, "");
    return (
      v === want ||
      v === padded ||
      t === want ||
      t === padded ||
      t.startsWith(want) ||
      t.includes(`${want}年`) ||
      t.includes(`${want}月`) ||
      t.includes(`${want}日`)
    );
  });
  if (!opt) return false;
  select.value = opt.value;
  select.dispatchEvent(new Event("change", { bubbles: true }));
  select.dispatchEvent(new Event("input", { bubbles: true }));
  return true;
}

function findDueDateInput() {
  const label = findLabelNode("完了予定日");
  if (!label) return null;
  let sib = label.nextElementSibling;
  for (let i = 0; i < 8 && sib; i += 1, sib = sib.nextElementSibling) {
    const input = sib.matches?.("input") ? sib : sib.querySelector?.("input:not([type=number])");
    if (input && visible(input) && !looksLikePrice(input) && input.type !== "number") return input;
  }
  const root = label.closest("tr, li, .form-item, .form-group, .field, section, div") || label.parentElement;
  const inputs = [...(root || document).querySelectorAll("input")].filter((el) => {
    if (!visible(el) || looksLikePrice(el) || el.type === "number") return false;
    return el.type === "date" || el.type === "text" || el.type === "hidden" || !el.type;
  });
  const named = inputs.find((el) =>
    /date|due|complete|delivery|finish|schedule|noki/i.test(`${el.name} ${el.id} ${el.className} ${el.placeholder}`)
  );
  if (named) return named;
  const dateType = inputs.find((el) => el.type === "date");
  if (dateType) return dateType;
  return inputs.find((el) => !/プロジェクト|完成|タイトル/.test(el.value || "")) || null;
}

function fillDueDate(due) {
  if (!due) return false;
  const dates = globalThis.JobBiderDates;
  const iso = `${due.y}-${String(due.m).padStart(2, "0")}-${String(due.d).padStart(2, "0")}`;
  const slash = `${due.y}/${String(due.m).padStart(2, "0")}/${String(due.d).padStart(2, "0")}`;
  const jp = dates && dates.formatJpDate ? dates.formatJpDate(due) : `${due.y}年${due.m}月${due.d}日`;
  const input = findDueDateInput();
  if (input) {
    const current = String(input.value || "");
    const next = input.type === "date" ? iso : /\//.test(current) || !current ? slash : /年/.test(current) ? jp : slash;
    pasteInto(input, next);
    if (input.type !== "date" && input.value !== next) pasteInto(input, iso);
    return Boolean(input.value);
  }
  const label = findLabelNode("完了予定日");
  const root = label ? label.closest("tr, li, .form-item, .form-group, section, div") || label.parentElement : null;
  const selects = [...(root || document).querySelectorAll("select")].filter(visible);
  if (selects.length >= 3) {
    return setSelectValue(selects[0], due.y) && setSelectValue(selects[1], due.m) && setSelectValue(selects[2], due.d);
  }
  return false;
}

function mergeExtract(incoming) {
  const live = extractPage();
  if (!incoming) return live;
  return {
    ...incoming,
    ...live,
    title: incoming.title || "",
    details: "",
    description: "",
    postedAt: live.postedAt || incoming.postedAt || null,
    dueAt: live.dueAt || incoming.dueAt || null,
    client: live.client && live.client !== "—" ? live.client : incoming.client || "—",
    budget: live.budget || incoming.budget || "",
    identity: live.identity ?? incoming.identity ?? null,
    completionRate: live.completionRate && live.completionRate !== "—" ? live.completionRate : incoming.completionRate || "—",
  };
}

async function fillApplication(extract) {
  const merged = mergeExtract(extract);
  const proposal = findProposalBox();
  if (proposal) pasteInto(proposal, "");
  let dueSet = false;
  if (/完了予定日/.test(document.body?.innerText || "")) {
    await randomWait();
    dueSet = fillDueDate(dueParts(merged));
  }
  return {
    ok: true,
    stage: "filled",
    stopped: true,
    cleared: Boolean(proposal),
    dueSet,
    extract: merged,
    description: "",
  };
}

async function prepare(msg) {
  const incoming = msg && msg.extract;
  if (isProposalPage()) {
    return fillApplication(incoming);
  }
  const extract = mergeExtract(incoming);
  const apply = findApplyControl();
  if (apply) {
    await randomWait();
    if (!safeClick(apply)) return fillApplication(extract);
    const start = Date.now();
    while (Date.now() - start < 8000) {
      await sleep(150);
      if (isProposalPage()) return fillApplication(extract);
    }
    return { ok: true, stage: "clicked_apply", extract, description: "", stopped: false };
  }
  return { ok: false, error: "no_apply_or_box", extract, description: "", stopped: true };
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
  prepare,
};
