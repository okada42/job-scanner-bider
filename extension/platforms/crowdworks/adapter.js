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

function sanitizeActorName(name) {
  const value = String(name || "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/さん$/, "");
  if (!value || value.length > 40 || /^ext-/i.test(value) || /login|会員|ログイン|sign\s*in/i.test(value)) return "";
  return value;
}

function parseEmbeddedJson(el) {
  if (!el) return null;
  const raw = el.getAttribute("data") || "";
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (_) {
    try {
      const ta = document.createElement("textarea");
      ta.innerHTML = raw;
      return JSON.parse(ta.value);
    } catch (e) {
      return null;
    }
  }
}

function tableValue(label) {
  for (const th of document.querySelectorAll("th")) {
    const text = (th.innerText || "").replace(/\s+/g, "");
    if (!text.includes(label)) continue;
    const td = th.parentElement?.querySelector("td");
    if (td) return (td.innerText || "").trim();
  }
  return "";
}

function headingSection(title) {
  const heads = [...document.querySelectorAll("h1, h2, h3, .cw-sub_head")];
  const head = heads.find((el) => (el.innerText || "").replace(/\s+/g, "").includes(title));
  if (!head) return null;
  return head.closest("section") || head.parentElement;
}

function extractTitle() {
  const h1 = document.querySelector("h1");
  if (!h1) return (document.title || "").replace(/\s*[-|｜].*$/, "").trim();
  const clone = h1.cloneNode(true);
  clone.querySelectorAll(".subtitle, a").forEach((n) => n.remove());
  return (clone.innerText || h1.innerText || "").trim();
}

function extractDetails() {
  const section = headingSection("仕事の詳細");
  if (section) {
    const cell = section.querySelector(".confirm_outside_link, .job_offer_detail_table td, td");
    const text = (cell?.innerText || section.innerText || "").trim();
    return text.replace(/^仕事の詳細\s*/, "").trim();
  }
  return "";
}

function verificationFromClient(info, fallbackText) {
  const bits = [];
  if (info) {
    if (info.isIdentityVerified === true) bits.push("本人確認済み");
    else if (info.isIdentityVerified === false) bits.push("本人確認未提出");
    if (info.isEmployerRuleCheckSucceeded === true) bits.push("発注ルールチェック済み");
    else if (info.isEmployerRuleCheckSucceeded === false) bits.push("発注ルールチェック未回答");
    if (info.isCertifiedEmployer) bits.push("認定クライアント");
  }
  if (!bits.length && fallbackText) {
    if (/本人確認済み/.test(fallbackText)) bits.push("本人確認済み");
    else if (/本人確認未提出/.test(fallbackText)) bits.push("本人確認未提出");
    if (/発注ルールチェック済み/.test(fallbackText)) bits.push("発注ルールチェック済み");
    else if (/発注ルールチェック未回答/.test(fallbackText)) bits.push("発注ルールチェック未回答");
  }
  return bits.join(" · ") || "—";
}

function extractClient() {
  const box = document.getElementById("client_detail_information_container");
  const info = parseEmbeddedJson(box);
  const header = document.querySelector(".client_information") || document.querySelector(".client_performance");
  const headerText = header?.innerText || "";
  const name =
    (info && info.userDisplayName) ||
    document.querySelector(".client_name")?.innerText?.trim() ||
    "";
  let achievement = "";
  let completionRate = "";
  if (info && info.jobOfferAchievementCount != null) achievement = `${info.jobOfferAchievementCount}件`;
  if (info && info.projectFinishedRate != null && info.projectFinishedRate !== "") {
    completionRate = `${info.projectFinishedRate}%`;
  }
  const clientSection = headingSection("クライアント情報");
  const block = (clientSection?.innerText || "") + "\n" + headerText;
  if (!achievement) {
    const m = block.match(/募集実績\s*[:：]?\s*([0-9]+)\s*件/);
    if (m) achievement = `${m[1]}件`;
  }
  if (!completionRate) {
    const m = block.match(/完了率\s*[:：]?\s*([0-9]+)\s*%/);
    if (m) completionRate = `${m[1]}%`;
    else if (/完了率[^\n]*—/.test(block) || /プロジェクト完了率[^\n]*—/.test(block)) completionRate = "—";
  }
  const identity =
    info && typeof info.isIdentityVerified === "boolean"
      ? info.isIdentityVerified
      : /本人確認済み/.test(block)
        ? true
        : /本人確認未提出/.test(block)
          ? false
          : null;
  const ruleCheck =
    info && typeof info.isEmployerRuleCheckSucceeded === "boolean"
      ? info.isEmployerRuleCheckSucceeded
      : /発注ルールチェック済み/.test(block)
        ? true
        : /発注ルールチェック未回答/.test(block)
          ? false
          : null;
  return {
    name: name || "—",
    verification: verificationFromClient(info, block),
    identity,
    ruleCheck,
    achievement: achievement || "—",
    completionRate: completionRate || "—",
  };
}

function extractPage() {
  const postedLabel = tableValue("掲載日");
  const postedAt = (globalThis.JobBiderDates && JobBiderDates.parseJpDate(postedLabel)) || null;
  const client = extractClient();
  const title = extractTitle();
  const details = extractDetails();
  return {
    title,
    details,
    description: details,
    client: client.name,
    verification: client.verification,
    identity: client.identity,
    ruleCheck: client.ruleCheck,
    achievement: client.achievement,
    completionRate: client.completionRate,
    postedLabel,
    postedAt,
    dueAt: postedAt && JobBiderDates.plusOneMonth(postedAt),
    url: location.href,
    at: new Date().toISOString(),
  };
}

function pasteBody(extract) {
  if (!extract) return "";
  return [extract.title, extract.details || extract.description].filter(Boolean).join("\n\n");
}

function looksLikePrice(el) {
  const row = el?.closest?.("tr, li, label, .form-group, .field, section, div");
  const blob = [
    el?.name,
    el?.id,
    el?.placeholder,
    el?.getAttribute?.("aria-label"),
    (row?.innerText || "").slice(0, 120),
  ].join(" ");
  return /契約金額|希望金額|提示金額|報酬|単価|price|budget|reward|contract_amount|payment_amount/i.test(blob);
}

function pasteInto(el, text) {
  if (!el) return false;
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
    if (vals.some((v) => /^\d{4}$/.test(v))) year = s;
    else if (vals.some((v) => /^(0?[1-9]|1[0-2])$/.test(v)) && vals.length <= 13) month = s;
    else day = s;
  }
  if (!year && selects[0]) year = selects[0];
  if (!month && selects[1]) month = selects[1];
  if (!day && selects[2]) day = selects[2];
  const okY = setSelectValue(year, due.y);
  const okM = setSelectValue(month, due.m);
  const okD = setSelectValue(day, due.d);
  return okY && okM && okD;
}

async function fillTemplate(extract) {
  const title = extract?.title || "";
  const body = pasteBody(extract);
  const create = visibleControls().find((el) => labelOf(el).includes("新しいテンプレートを作成"));
  if (create) {
    create.click();
    await sleep(300);
  }
  const dialogs = [...document.querySelectorAll("[role='dialog'], .modal, [class*='Modal'], [class*='dialog']")].filter(
    visible
  );
  const root = dialogs[dialogs.length - 1] || document;
  const inputs = [...root.querySelectorAll("input[type=text], input:not([type])")].filter(
    (el) => visible(el) && !looksLikePrice(el) && el.type !== "number"
  );
  if (inputs[0] && title) pasteInto(inputs[0], title.slice(0, 80));
  const areas = [...root.querySelectorAll("textarea")].filter((el) => visible(el) && !looksLikePrice(el));
  const area = areas.sort((a, b) => (b.offsetHeight || 0) - (a.offsetHeight || 0))[0] || findProposalBox();
  if (!area || looksLikePrice(area)) return { pasted: false };
  pasteInto(area, body);
  return { pasted: true };
}

async function fillApplication(extract) {
  const due = extract?.dueAt || (extract?.postedAt && JobBiderDates.plusOneMonth(extract.postedAt));
  let dueSet = false;
  if (/完了予定日/.test(document.body?.innerText || "")) {
    await randomWait();
    dueSet = fillDueDate(due);
  }
  const tmpl = await fillTemplate(extract);
  return {
    ok: true,
    stage: "filled",
    stopped: true,
    dueSet,
    pasted: Boolean(tmpl.pasted),
    extract,
    description: extract?.details || "",
  };
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
  };
}

function isSentPage() {
  return /\/proposals\/\d+/.test(location.pathname);
}

async function prepare(msg) {
  const incoming = msg && msg.extract;
  if (isSentPage()) {
    return { ok: true, stage: "sent", stopped: true, extract: incoming || null };
  }
  if (isProposalPage()) {
    return fillApplication(mergeExtract(incoming));
  }
  const extract = mergeExtract(incoming);
  const apply = findApplyControl();
  if (apply) {
    await randomWait();
    apply.click();
    for (let i = 0; i < 40; i += 1) {
      await sleep(150);
      if (isProposalPage()) return fillApplication(extract);
    }
    return { ok: true, stage: "clicked_apply", extract, description: extract.details, stopped: false };
  }
  return { ok: false, error: "no_apply_or_box", extract, description: extract.details, stopped: true };
}

window.JobBiderPlatform = {
  name: "crowdworks",
  findApplyControl,
  findProposalBox,
  extractDescription: () => extractDetails() || (document.body.innerText || "").slice(0, 20000),
  extractPage,
  extractLoggedInUser,
  isProposalPage,
  prepare,
};

function extractLoggedInUser() {
  const headerName =
    document.querySelector('header [class*="_normanHeaderUserMenu_"] [class*="_username_"]') ||
    document.querySelector('[class*="_normanProfileClickable_"] [class*="_username_"]') ||
    document.querySelector('[class*="_normanProfileClickable_"] span');
  const fromHeader = sanitizeActorName(headerName && headerName.innerText);
  if (fromHeader) return fromHeader;
  const gon = window.gon && window.gon.current_user;
  if (gon) {
    const fromGon = sanitizeActorName(gon.display_name || gon.username || gon.name);
    if (fromGon) return fromGon;
  }
  const nuxt = window.__NUXT__ && window.__NUXT__.state;
  const fromState =
    nuxt &&
    (nuxt.currentUser || nuxt.current_user || (nuxt.auth && (nuxt.auth.user || nuxt.auth.currentUser)));
  if (fromState) {
    const fromNuxt = sanitizeActorName(
      fromState.displayName || fromState.display_name || fromState.username || fromState.name
    );
    if (fromNuxt) return fromNuxt;
  }
  const sels = [
    "[data-current-user-name]",
    "#header-username",
    ".cw-header_username",
    ".header-account-name",
    "header a[href*='/mypage']",
    "a[href*='/mypage'] .name",
  ];
  for (const sel of sels) {
    const el = document.querySelector(sel);
    const text = sanitizeActorName(el && (el.getAttribute("data-current-user-name") || el.innerText));
    if (text) return text;
  }
  return "";
}
