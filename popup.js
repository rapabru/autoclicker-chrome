document.addEventListener("DOMContentLoaded", () => {
  const btnToggle = document.getElementById("btn-toggle");

  btnToggle.addEventListener("click", async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab || !tab.id) return;

      try {
        await chrome.tabs.sendMessage(tab.id, { action: "toggle-panel" });
      } catch (e) {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ["content.js"]
        });
        await new Promise(r => setTimeout(r, 100));
        await chrome.tabs.sendMessage(tab.id, { action: "toggle-panel" });
      }

      window.close();
    } catch (err) {
      console.error("Error al abrir el panel:", err);
    }
  });
});
