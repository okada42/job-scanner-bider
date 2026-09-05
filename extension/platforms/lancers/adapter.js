const APPLY_LABELS = ["提案する", "この仕事に提案"];
const FINAL_LABELS = ["提案を送信", "送信する", "この内容で提案", "確認画面へ", "この内容で送信"];

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
  return sleep(1000 + Math.floor(Math.random() * 2000));
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
  if (/完了予定日|見積もり|自己PR|タイトル/.test(blob)) return false;
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

function labeledBlock(title) {
  const head = findLabelNode(title);
  if (!head) return "";
  const row = head.closest("tr, dl, section, article, .form-item") || head.parentElement;
  const value = (row && row.querySelector("td, dd, .value, [class*='detail']")) || head.nextElementSibling;
  return (value?.innerText || row?.innerText || "").replace(new RegExp(`^${title}\\s*`), "").trim();
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

function findApplyControl() {
  const buttons = visibleButtons();
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
  return findLabeledControl(["自己PR・実績", "自己PR"], "textarea") || findEstimateBox();
}

function findEstimateBox() {
  return findLabeledControl(["見積もりの詳細"], "textarea");
}

function extractTitle() {
  const h1 = document.querySelector("h1.c-heading.c-heading--lv1, header.l-page-header h1, h1");
  if (h1) {
    const clone = h1.cloneNode(true);
    clone.querySelectorAll("a, .c-heading__sub, .c-badge, [class*='badge'], small, .subtitle").forEach((n) => n.remove());
    const text = (clone.innerText || "").replace(/\s+/g, " ").trim();
    if (text) return text;
  }
  return labeledCell("依頼タイトル") || (document.title || "").replace(/\s*[-|｜]\s*ランサーズ.*$/, "").trim();
}

function headingSection(title) {
  const heads = [...document.querySelectorAll("h1, h2, h3, h4, dt, th, .heading, [class*='Title'], [class*='heading']")];
  const head = heads.find((el) => compact(el.innerText).includes(compact(title)));
  if (!head) return null;
  return head.closest("section, article, dl, table, .section, [class*='section']") || head.parentElement;
}

function sectionText(title) {
  const section = headingSection(title);
  const raw = (section?.innerText || "").trim();
  return raw.replace(new RegExp(`^${title}\\s*`), "").trim();
}

function extractDetails() {
  const fromTable = labeledBlock("詳細");
  if (fromTable && fromTable.length > 20 && !/^クライアント名/.test(fromTable)) {
    return fromTable.replace(/続きを読む/g, "").trim();
  }
  for (const title of ["依頼詳細", "依頼概要", "仕事の詳細", "仕事内容", "募集内容", "見積もり募集の内容"]) {
    const text = sectionText(title);
    if (text && text.length > 20) return text.replace(/続きを読む/g, "").trim();
  }
  const main = document.querySelector("main, article, .p-work-detail-lancer, [class*='work-detail']");
  return (main?.innerText || "").trim();
}

function extractClient() {
  const fromRow = labeledCell("クライアント名") || labeledCell("依頼主") || labeledCell("クライアント");
  if (fromRow && fromRow.length <= 60 && !/業種|予算|ログイン/.test(fromRow)) return fromRow;
  const side = document.querySelector(
    "aside [class*='client'], [class*='client-info'], [class*='ClientInfo'], [class*='employer'], aside"
  );
  const sideText = (side?.innerText || "").replace(/\s+/g, " ").trim();
  const named = sideText.match(/([^\n]{1,20})\s*\(([a-zA-Z0-9_.-]{2,40})\)/);
  if (named) return `${named[1].trim()} (${named[2]})`;
  const link = document.querySelector(
    "a[href*='/client/'], a[href*='/user/'], a[href*='/profile/'], [class*='client'] a, [class*='Client'] a"
  );
  const name = (link?.innerText || "").replace(/\s+/g, " ").trim();
  if (name && name.length <= 60 && !/ログイン|会員|提案/.test(name)) return name;
  return "";
}

function extractBudget() {
  const fromRow = labeledCell("依頼予算") || labeledCell("提示した予算") || labeledCell("予算");
  if (fromRow && /円/.test(fromRow)) return fromRow;
  const blob = document.body ? document.body.innerText : "";
  const project = blob.match(/プロジェクト\s*[~～〜]\s*([\d,]+円)/);
  if (project) return `~ ${project[1]}`;
  const yen = blob.match(/[~～〜]\s*([\d,]+円)/);
  return yen ? `~ ${yen[1]}` : fromRow || "";
}

function extractPosted() {
  return labeledCell("募集開始日時") || labeledCell("募集開始") || labeledCell("掲載日") || "";
}

function extractDeadline() {
  return labeledCell("募集締切日時") || labeledCell("募集締切") || labeledCell("締切") || "";
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
    dueAt: postedAt && dates ? dates.plusOneMonth(postedAt) : null,
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
  if (/propose_start|\/proposal|offer|entry/.test(location.pathname)) return true;
  const blob = document.body ? document.body.innerText.slice(0, 6000) : "";
  if (/見積もりの詳細/.test(blob) && /自己PR/.test(blob)) return true;
  if (/完了予定日/.test(blob) && /契約金額/.test(blob) && !findApplyControl()) return true;
  return Boolean((findEstimateBox() || findProposalBox()) && !findApplyControl());
}

function extractDescription() {
  return extractDetails() || (document.body?.innerText || "").trim();
}

function dueParts(extract) {
  const dates = globalThis.JobBiderDates;
  if (!dates) return null;
  if (extract?.dueAt) return extract.dueAt;
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

async function expandReadMore() {
  const links = visibleButtons().filter((el) => /続きを読む/.test(labelOf(el)));
  for (const link of links) {
    link.click();
    await sleep(200);
  }
}

function mergeExtract(incoming) {
  const live = extractPage();
  if (!incoming) return live;
  return {
    ...live,
    ...incoming,
    title: incoming.title || live.title,
    details: incoming.details || incoming.description || live.details,
    description: incoming.details || incoming.description || live.description,
    postedAt: incoming.postedAt || live.postedAt,
    dueAt: incoming.dueAt || live.dueAt,
    client: incoming.client && incoming.client !== "—" ? incoming.client : live.client,
    budget: incoming.budget || live.budget,
  };
}

async function fillApplication(extract) {
  await expandReadMore();
  const merged = mergeExtract(extract);
  const description = merged.details || merged.description || "";
  const estimate = findEstimateBox();
  if (estimate) pasteInto(estimate, ".");
  const pr = findLabeledControl(["自己PR・実績", "自己PR"], "textarea");
  if (pr) pasteInto(pr, description);
  let dueSet = false;
  if (/完了予定日/.test(document.body?.innerText || "")) {
    await randomWait();
    dueSet = fillDueDate(dueParts(merged));
  }
  return {
    ok: true,
    stage: "filled",
    stopped: true,
    pasted: Boolean(pr && description),
    estimateCleared: Boolean(estimate),
    dueSet,
    extract: merged,
    description,
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
    apply.click();
    const start = Date.now();
    while (Date.now() - start < 8000) {
      await sleep(300);
      if (isProposalPage()) return fillApplication(extract);
    }
    return { ok: true, stage: "clicked_apply", extract, description: extract.details, stopped: false };
  }
  return { ok: false, error: "no_apply_or_box", extract, description: extract.details, stopped: true };
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
