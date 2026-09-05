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

function isLoggedOut() {
  if (document.querySelector("a[href*='/logout'], [href*='mypage'], .c-header__user, [class*='header'] [class*='avatar']")) {
    return false;
  }
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

const DUE_LABELS = ["完了予定日", "納品予定日", "完了予定", "納期"];
const DATE_FIELD_RE = /date|due|complete|delivery|deliver|finish|schedule|noki|kanryo|calendar|picker/i;

// The deepest element whose own text starts with one of the labels (the visible caption of the field).
function findDueLabelNode() {
  const wants = DUE_LABELS.map(compact);
  const all = [...document.querySelectorAll("label, th, dt, legend, p, span, div, h2, h3, h4, li")];
  const hits = all.filter((el) => {
    if (!visible(el) && el.tagName !== "LABEL") return false;
    const t = compact(el.innerText);
    if (!t || t.length > 40) return false;
    return wants.some((w) => t === w || t.startsWith(w));
  });
  if (!hits.length) return null;
  hits.sort((a, b) => (a.contains(b) ? 1 : b.contains(a) ? -1 : 0));
  return hits[0];
}

function follows(anchor, el) {
  return Boolean(anchor.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING);
}

// Controls that come after the label in document order, nearest first.
function controlsAfter(anchor, selector, limit = 12) {
  if (!anchor) return [];
  const out = [];
  for (const el of document.querySelectorAll(selector)) {
    if (!follows(anchor, el)) continue;
    out.push(el);
    if (out.length >= limit) break;
  }
  return out;
}

function isDateInput(el) {
  if (!el || looksLikePrice(el) || el.type === "number" || el.inputMode === "numeric") return false;
  if (["checkbox", "radio", "submit", "button", "file", "email", "password", "search", "url", "tel"].includes(el.type)) {
    return false;
  }
  return true;
}

function findDueDateInput() {
  const label = findDueLabelNode();
  const scoped = label ? controlsAfter(label, "input", 10).filter(isDateInput) : [];
  const pick = (list) => {
    const dateType = list.find((el) => el.type === "date" && visible(el));
    if (dateType) return dateType;
    const named = list.find(
      (el) => visible(el) && DATE_FIELD_RE.test(`${el.name} ${el.id} ${el.className} ${el.placeholder}`)
    );
    if (named) return named;
    const shown = list.find((el) => visible(el) && (el.type === "text" || !el.type));
    if (shown && !/プロジェクト|完成|タイトル/.test(shown.value || "")) return shown;
    return list.find((el) => el.type === "hidden" && DATE_FIELD_RE.test(`${el.name} ${el.id}`)) || null;
  };
  const near = pick(scoped.slice(0, 4));
  if (near) return near;
  const global = [...document.querySelectorAll("input")].filter(
    (el) => isDateInput(el) && visible(el) && DATE_FIELD_RE.test(`${el.name} ${el.id} ${el.className} ${el.placeholder}`)
  );
  return pick(global) || pick(scoped);
}

function findDueDateSelects() {
  const label = findDueLabelNode();
  const pool = (label ? controlsAfter(label, "select", 6) : [...document.querySelectorAll("select")]).filter(
    (s) => visible(s) && !looksLikePrice(s)
  );
  if (pool.length < 3) return null;
  let year;
  let month;
  let day;
  for (const s of pool.slice(0, 5)) {
    const vals = [...s.options].map((o) => String(o.value || o.textContent || "").trim()).filter(Boolean);
    if (!year && vals.some((v) => /^\d{4}/.test(v))) year = s;
    else if (!month && vals.filter((v) => /^\d{1,2}$/.test(v)).length <= 12 && vals.some((v) => /^(0?[1-9]|1[0-2])$/.test(v))) month = s;
    else if (!day && vals.filter((v) => /^\d{1,2}$/.test(v)).length >= 28) day = s;
  }
  if (!year || !month || !day) [year, month, day] = pool;
  return { year, month, day };
}

function dueStrings(due) {
  const dates = globalThis.JobBiderDates;
  const mm = String(due.m).padStart(2, "0");
  const dd = String(due.d).padStart(2, "0");
  return {
    iso: `${due.y}-${mm}-${dd}`,
    slash: `${due.y}/${mm}/${dd}`,
    jp: dates && dates.formatJpDate ? dates.formatJpDate(due) : `${due.y}年${mm}月${dd}日`,
  };
}

function valueMatchesDue(value, due) {
  const v = String(value || "");
  return v.includes(String(due.y)) && (v.includes(String(due.d).padStart(2, "0")) || /\D\d\D|\d$/.test(v));
}

function setInputValue(input, text) {
  pasteInto(input, text);
  input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  input.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", bubbles: true }));
  return String(input.value || "") === text;
}

function visiblePicker() {
  const sel =
    ".ui-datepicker, .datepicker, .flatpickr-calendar.open, .vdp-datepicker__calendar, .react-datepicker, .daterangepicker, " +
    "[class*='datepicker']:not(input), [class*='Datepicker']:not(input), [class*='calendar']:not(input), [class*='Calendar']:not(input)";
  return [...document.querySelectorAll(sel)].filter((el) => visible(el) && el.querySelector("td, [role='gridcell'], [data-date]"))[0] || null;
}

function pickerMonth(picker) {
  const text = picker.innerText || "";
  const jp = text.match(/(\d{4})\s*年\s*(\d{1,2})\s*月/);
  if (jp) return { y: Number(jp[1]), m: Number(jp[2]) };
  const en = text.match(/(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})/i);
  if (en) {
    const months = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
    return { y: Number(en[2]), m: months.indexOf(en[1].toLowerCase()) + 1 };
  }
  const num = text.match(/(\d{4})[./-](\d{1,2})/);
  return num ? { y: Number(num[1]), m: Number(num[2]) } : null;
}

async function pickFromCalendar(input, due) {
  input.focus();
  input.click();
  let picker = null;
  for (let i = 0; i < 4 && !picker; i += 1) {
    await sleep(120);
    picker = visiblePicker();
  }
  if (!picker) return false;
  const monthSel = picker.querySelector("select[class*='month'], select[data-handler='selectMonth']");
  const yearSel = picker.querySelector("select[class*='year'], select[data-handler='selectYear']");
  if (yearSel) setSelectValue(yearSel, due.y);
  if (monthSel) {
    const zero = [...monthSel.options].some((o) => o.value === "0");
    setSelectValue(monthSel, zero ? due.m - 1 : due.m);
  }
  for (let i = 0; i < 14; i += 1) {
    const cur = pickerMonth(picker);
    if (!cur || (cur.y === due.y && cur.m === due.m)) break;
    const forward = cur.y < due.y || (cur.y === due.y && cur.m < due.m);
    const nav = [...picker.querySelectorAll("a, button, span, div")].find((el) => {
      const cls = `${el.className} ${el.getAttribute("aria-label") || ""} ${el.title || ""}`;
      return forward ? /next|次/i.test(cls) || labelOf(el) === "›" || labelOf(el) === ">" : /prev|前/i.test(cls) || labelOf(el) === "‹" || labelOf(el) === "<";
    });
    if (!nav) break;
    nav.click();
    await sleep(100);
    picker = visiblePicker() || picker;
  }
  const want = String(due.d);
  const cells = [...picker.querySelectorAll("td a, td button, td span, td, [role='gridcell'], [data-date], .flatpickr-day")];
  const cell = cells.find((el) => {
    if (!visible(el)) return false;
    const cls = String(el.className || "") + " " + String(el.parentElement?.className || "");
    if (/other-month|disabled|outside|prevMonth|nextMonth|unavailable/i.test(cls) || el.getAttribute("aria-disabled") === "true") return false;
    const data = el.getAttribute("data-date") || el.getAttribute("aria-label") || "";
    if (/\d{4}/.test(data)) return valueMatchesDue(data, due) && new RegExp(`(^|\\D)0?${want}(\\D|$)`).test(data);
    return labelOf(el) === want;
  });
  if (!cell) return false;
  cell.click();
  await sleep(120);
  return Boolean(input.value);
}

async function fillDueDate(due) {
  if (!due) return false;
  const strings = dueStrings(due);
  const selects = findDueDateSelects();
  if (selects && selects.year && selects.month && selects.day) {
    const ok = setSelectValue(selects.year, due.y) && setSelectValue(selects.month, due.m) && setSelectValue(selects.day, due.d);
    if (ok) return true;
  }
  const input = findDueDateInput();
  if (!input) return false;
  if (input.type === "date") return setInputValue(input, strings.iso) || valueMatchesDue(input.value, due);
  const current = String(input.value || input.placeholder || "");
  const order = /年/.test(current) ? [strings.jp, strings.slash, strings.iso] : /-/.test(current) ? [strings.iso, strings.slash, strings.jp] : [strings.slash, strings.iso, strings.jp];
  if (!input.readOnly) {
    for (const text of order) {
      if (setInputValue(input, text) && valueMatchesDue(input.value, due)) return true;
    }
  }
  if (await pickFromCalendar(input, due)) return true;
  if (input.type === "hidden" || input.readOnly) {
    setInputValue(input, order[0]);
    return valueMatchesDue(input.value, due);
  }
  return valueMatchesDue(input.value, due);
}

// On /work/propose_start/: clear 提案文 and set 完了予定日 to one month from today. Nothing is read
// from the page except the form controls themselves.
async function fillApplication() {
  const proposal = findProposalBox();
  if (proposal) pasteInto(proposal, "");
  let dueSet = false;
  const due = globalThis.JobBiderDates ? JobBiderDates.dueOneMonthFromToday() : null;
  // The form can render after load; wait briefly (in 150ms steps) for the date field to appear.
  for (let i = 0; i < 6 && !findDueLabelNode() && !findDueDateInput(); i += 1) await sleep(150);
  await randomWait();
  try {
    dueSet = await fillDueDate(due);
  } catch (_) {
    dueSet = false;
  }
  return { ok: true, stage: "filled", stopped: true, cleared: Boolean(proposal), dueSet, due };
}

// On /work/detail/: click 提案する, then fill the form once it appears.
async function prepare() {
  if (isProposalPage()) return fillApplication();
  const apply = findApplyControl();
  if (!apply) return { ok: false, error: "no_apply_or_box", stopped: true };
  await randomWait();
  if (!safeClick(apply)) return fillApplication();
  const start = Date.now();
  while (Date.now() - start < 8000) {
    await sleep(150);
    if (isProposalPage()) return fillApplication();
  }
  return { ok: true, stage: "clicked_apply", stopped: false };
}

window.JobBiderPlatform = {
  name: "lancers",
  findApplyControl,
  findProposalBox,
  isLoggedOut,
  isProposalPage,
  prepare,
  __test: { fillDueDate, findDueDateInput, findDueLabelNode },
};
