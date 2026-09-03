function parseJpDate(text) {
  const m = String(text || "").match(/(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/);
  if (!m) return null;
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
}

function plusOneMonth(parts) {
  if (!parts || !parts.y) return null;
  const dt = new Date(parts.y, parts.m - 1, parts.d);
  const day = dt.getDate();
  dt.setMonth(dt.getMonth() + 1);
  if (dt.getDate() !== day) dt.setDate(0);
  return { y: dt.getFullYear(), m: dt.getMonth() + 1, d: dt.getDate() };
}

function formatJpDate(parts) {
  if (!parts) return "";
  return `${parts.y}年${String(parts.m).padStart(2, "0")}月${String(parts.d).padStart(2, "0")}日`;
}

globalThis.JobBiderDates = { parseJpDate, plusOneMonth, formatJpDate };
