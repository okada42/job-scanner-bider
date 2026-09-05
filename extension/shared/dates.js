function parseJpDate(text) {
  const m = String(text || "").match(/(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日(?:\s*[月火水木金土日]曜日)?(?:\s*(\d{1,2}):(\d{2}))?/);
  if (!m) return null;
  return {
    y: Number(m[1]),
    m: Number(m[2]),
    d: Number(m[3]),
    h: m[4] != null ? Number(m[4]) : null,
    min: m[5] != null ? Number(m[5]) : null,
  };
}

function plusOneMonth(parts) {
  if (!parts || !parts.y) return null;
  const dt = new Date(parts.y, parts.m - 1, parts.d);
  const day = dt.getDate();
  dt.setMonth(dt.getMonth() + 1);
  if (dt.getDate() !== day) dt.setDate(0);
  return { y: dt.getFullYear(), m: dt.getMonth() + 1, d: dt.getDate(), h: parts.h, min: parts.min };
}

function formatJpDate(parts) {
  if (!parts) return "";
  const date = `${parts.y}年${String(parts.m).padStart(2, "0")}月${String(parts.d).padStart(2, "0")}日`;
  if (parts.h == null || parts.min == null) return date;
  return `${date} ${String(parts.h).padStart(2, "0")}:${String(parts.min).padStart(2, "0")}`;
}

function formatCompact(partsOrText) {
  const parts = partsOrText && typeof partsOrText === "object" ? partsOrText : parseJpDate(partsOrText);
  if (parts && parts.m && parts.d) {
    const date = `${parts.m}/${parts.d}`;
    if (parts.h == null || parts.min == null) return date;
    return `${date} ${String(parts.h).padStart(2, "0")}:${String(parts.min).padStart(2, "0")}`;
  }
  const raw = String(partsOrText || "").trim();
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/);
  if (iso) {
    const date = `${Number(iso[2])}/${Number(iso[3])}`;
    return iso[4] != null ? `${date} ${iso[4]}:${iso[5]}` : date;
  }
  return raw.replace(/\s+/g, " ");
}

function todayJst() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Tokyo" });
}

// 完了予定日 for every proposal: one month from today (Japan time). Nothing is read from the job page.
function dueOneMonthFromToday() {
  const m = todayJst().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return plusOneMonth({ y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) });
}

globalThis.JobBiderDates = { parseJpDate, plusOneMonth, formatJpDate, formatCompact, todayJst, dueOneMonthFromToday };
