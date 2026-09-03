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

function todayJst() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Tokyo" });
}

globalThis.JobBiderDates = { parseJpDate, plusOneMonth, formatJpDate, todayJst };
