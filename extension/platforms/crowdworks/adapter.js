const APPLY_LABELS = ["応募画面へ", "この仕事に応募", "応募"];
const FINAL_LABELS = ["送信する", "提出する", "応募を送信", "この内容で応募", "応募する"];

function visible(el) {
  if (!el) return false;
  const s = getComputedStyle(el);
  return s.display !== "none" && s.visibility !== "hidden" && el.offsetParent !== null;
}

function visibleControls() {
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

const PRICE_RE = /契約金額|税抜|税込|金額|希望金額|提示金額|報酬|単価|price|amount|budget|reward|contract_amount|payment_amount|yen|円/i;

function labelTextFor(el) {
  const bits = [];
  if (el?.id) {
    for (const lab of document.querySelectorAll(`label[for="${el.id}"]`)) bits.push(lab.innerText || "");
  }
  const wrap = el?.closest?.("label");
  if (wrap) bits.push(wrap.innerText || "");
  if (el?.getAttribute?.("aria-labelledby")) {
    for (const id of el.getAttribute("aria-labelledby").split(/\s+/)) {
      bits.push(document.getElementById(id)?.innerText || "");
    }
  }
  return bits.join(" ");
}

function looksLikePrice(el) {
  if (!el) return false;
  if (el.type === "number" || el.inputMode === "numeric" || el.inputMode === "decimal") return true;
  const own = [el.name, el.id, el.className, el.placeholder, el.getAttribute?.("aria-label"), labelTextFor(el)];
  // A textarea is judged by its own attributes and label only; its surrounding section
  // legitimately mentions 契約金額 and must not block the proposal body.
  if (el.tagName === "TEXTAREA") return PRICE_RE.test(own.join(" "));
  const row = el.closest?.("tr, li, label, .form-group, .field, section, fieldset, dl");
  const blob = [
    ...own,
    (el.previousElementSibling?.innerText || "").slice(0, 60),
    (row?.innerText || "").slice(0, 160),
  ].join(" ");
  return PRICE_RE.test(blob);
}

// Only the proposal textarea is ever written. CrowdWorks 契約金額（税抜） is an <input>; we never touch inputs.
function pasteInto(el, text) {
  if (!el) return false;
  if (el.tagName !== "TEXTAREA" || looksLikePrice(el)) return false;
  el.focus();
  el.value = text;
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
  return true;
}

function findApplyControl() {
  const buttons = visibleControls();
  for (const wanted of ["応募画面へ", "この仕事に応募"]) {
    const hit = buttons.find((el) => labelOf(el).includes(wanted));
    if (hit) return hit;
  }
  return buttons.find((el) => {
    const t = labelOf(el);
    if (FINAL_LABELS.some((f) => t.includes(f))) return false;
    if (t === "応募する") return false;
    return APPLY_LABELS.some((l) => t.includes(l));
  });
}

function findProposalBox() {
  const areas = [...document.querySelectorAll("textarea")].filter(visible);
  if (!areas.length) return null;
  return areas.sort((a, b) => (b.offsetHeight || 0) - (a.offsetHeight || 0))[0];
}

function isProposalPage() {
  const blob = `${location.pathname} ${location.search} ${document.body ? document.body.innerText.slice(0, 4000) : ""}`;
  if (/完了予定日|新しいテンプレートを作成|契約金額の提示/.test(blob)) return true;
  if (/proposal|job_applications|entries|offers\/new/.test(location.pathname)) return true;
  return Boolean(findProposalBox() && !findApplyControl());
}

function setSelectValue(select, num) {
  if (!select) return false;
  const want = String(num);
  const padded = want.padStart(2, "0");
  const opt = [...select.options].find((o) => {
    const v = String(o.value || "");
    const t = String(o.textContent || "").replace(/\s+/g, "");
    return v === want || v === padded || t === want || t === padded || t.startsWith(want) || t.includes(`${want}年`) || t.includes(`${want}月`) || t.includes(`${want}日`);
  });
  if (!opt) return false;
  select.value = opt.value;
  select.dispatchEvent(new Event("change", { bubbles: true }));
  select.dispatchEvent(new Event("input", { bubbles: true }));
  return true;
}

function dueDateSelects() {
  const label = [...document.querySelectorAll("label, th, h3, h4, dt, div, span")].find((el) => {
    const t = (el.innerText || "").replace(/\s+/g, "");
    return t.startsWith("完了予定日") || t === "完了予定日任意";
  });
  const root = label ? label.closest("tr, li, .form-group, .field, section, div") || label.parentElement : null;
  const pool = [...(root || document).querySelectorAll("select")].filter(visible);
  const named = pool.filter((s) => /complete|delivery|due_date|scheduled|finish|expected/i.test(`${s.name} ${s.id}`));
  const list = named.length >= 3 ? named : pool;
  if (list.length < 3 && !root) return [];
  return list.slice(0, 3);
}

function fillDueDate(due) {
  if (!due) return false;
  if (!/完了予定日/.test(document.body?.innerText || "")) return false;
  const selects = dueDateSelects();
  if (!selects.length) return false;
  let year;
  let month;
  let day;
  for (const s of selects) {
    const vals = [...s.options].map((o) => o.value).filter(Boolean);
    if (!year && vals.some((v) => /^\d{4}$/.test(v))) year = s;
    else if (!month && vals.some((v) => /^(0?[1-9]|1[0-2])$/.test(v)) && vals.length <= 13) month = s;
    else if (!day) day = s;
  }
  if (!year && selects[0]) year = selects[0];
  if (!month && selects[1]) month = selects[1];
  if (!day && selects[2]) day = selects[2];
  const okY = setSelectValue(year, due.y);
  const okM = setSelectValue(month, due.m);
  const okD = setSelectValue(day, due.d);
  return okY && okM && okD;
}

// On the proposal page: clear the message <textarea> and set 完了予定日 to one month from today.
// Nothing on this page is clicked (新しいテンプレートを作成 links to /u/message_templates/new.json
// and would turn the tab into raw JSON) and no <input> is ever written (契約金額（税抜） is one).
async function fillApplication() {
  const due = globalThis.JobBiderDates ? JobBiderDates.dueOneMonthFromToday() : null;
  let dueSet = false;
  if (/完了予定日/.test(document.body?.innerText || "")) {
    await randomWait();
    dueSet = fillDueDate(due);
  }
  const area = findProposalBox();
  const cleared = area && !looksLikePrice(area) ? pasteInto(area, "") : false;
  return { ok: true, stage: "filled", stopped: true, dueSet, cleared, due };
}

function isSentPage() {
  return /\/proposals\/\d+/.test(location.pathname);
}

// On /public/jobs/{id}: click 応募画面へ, then fill the form once it appears.
async function prepare() {
  if (isSentPage()) return { ok: true, stage: "sent", stopped: true };
  if (isProposalPage()) return fillApplication();
  const apply = findApplyControl();
  if (!apply) return { ok: false, error: "no_apply_or_box", stopped: true };
  await randomWait();
  apply.click();
  for (let i = 0; i < 40; i += 1) {
    await sleep(150);
    if (isProposalPage()) return fillApplication();
  }
  return { ok: true, stage: "clicked_apply", stopped: false };
}

window.JobBiderPlatform = {
  name: "crowdworks",
  findApplyControl,
  findProposalBox,
  isProposalPage,
  prepare,
};
