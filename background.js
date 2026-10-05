// Background Service Worker (Manifest V3)

chrome.commands.onCommand.addListener(async (command) => {
  if (command === "toggle-autoclicker") {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.id) {
      try {
        await chrome.tabs.sendMessage(tab.id, { action: "toggle-panel" });
      } catch (err) {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ["content.js"]
        });
      }
    }
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "get-status") {
    sendResponse({ ok: true });
  }
  return true;
});
