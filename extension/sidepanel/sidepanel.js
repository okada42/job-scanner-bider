async function paint() {
  const state = await chrome.runtime.sendMessage({ type: "GET_STATE" });
  const job = state.currentJob;
  document.getElementById("title").textContent = job?.title || (state.paused ? "Paused" : "No active job");
  document.getElementById("budget").textContent = job?.budget ? `💰 ${job.budget}` : "";
  document.getElementById("client").textContent = job?.client ? `👤 ${job.client}` : "";
  document.getElementById("deadline").textContent = job?.deadline ? `📅 ${job.deadline}` : "";
}

document.getElementById("skip").onclick = () => chrome.runtime.sendMessage({ type: "SKIP" }).then(paint);
document.getElementById("next").onclick = () => chrome.runtime.sendMessage({ type: "NEXT" }).then(paint);
document.getElementById("prepare").onclick = async () => {
  const res = await chrome.runtime.sendMessage({ type: "PREPARE_TAB" });
  if (res?.description) document.getElementById("desc").textContent = res.description.slice(0, 4000);
  else if (res?.stage) document.getElementById("desc").textContent = `Stage: ${res.stage}`;
};

chrome.storage.onChanged.addListener(paint);
paint();
setInterval(paint, 3000);
