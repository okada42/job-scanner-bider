window.BiderCoconala = {
  match: (url) => url.includes("coconala.com"),
  extract() {
    return {
      title: document.querySelector("h1")?.innerText?.trim() || document.title,
      description: window.BiderShared.pageText(),
    };
  },
  async prepare() {
    window.BiderShared.clickByText(["応募", "提案"]);
    await new Promise((r) => setTimeout(r, 300));
    const box = window.BiderShared.largestTextarea();
    const description = window.BiderShared.pageText();
    if (box) {
      box.focus();
      box.value = description;
      box.dispatchEvent(new Event("input", { bubbles: true }));
    }
    return { ready: !!box, description };
  },
};
