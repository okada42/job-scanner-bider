chrome.storage.sync.get({ backendUrl: "http://127.0.0.1:8000", token: "" }, (c) => {
  document.getElementById("backendUrl").value = c.backendUrl;
  document.getElementById("token").value = c.token;
});
document.getElementById("save").onclick = () => {
  chrome.storage.sync.set({
    backendUrl: document.getElementById("backendUrl").value.trim(),
    token: document.getElementById("token").value.trim(),
  });
};
