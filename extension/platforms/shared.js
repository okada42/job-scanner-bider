const SUBMIT_RE = /送信|応募する$|提案を送信|この内容で応募/;

function visibleButtons() {
  return [...document.querySelectorAll("a, button, input[type=submit], input[type=button]")]
    .filter((el) => el.offsetParent !== null);
}

function clickByText(patterns) {
  const el = visibleButtons().find((node) => patterns.some((p) => (node.textContent || node.value || "").trim().includes(p)));
  if (el && !SUBMIT_RE.test((el.textContent || el.value || "").trim())) {
    el.click();
    return true;
  }
  return false;
}

function largestTextarea() {
  const areas = [...document.querySelectorAll("textarea")].filter((t) => t.offsetParent !== null);
  return areas.sort((a, b) => (b.offsetHeight * b.offsetWidth) - (a.offsetHeight * a.offsetWidth))[0];
}

function pageText() {
  return document.body ? document.body.innerText.slice(0, 20000) : "";
}

window.BiderShared = { clickByText, largestTextarea, pageText, SUBMIT_RE };
