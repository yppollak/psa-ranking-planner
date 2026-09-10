// Clicking the toolbar icon opens the sync page — or focuses it if already open.
const PAGE = chrome.runtime.getURL("runner.html");

chrome.action.onClicked.addListener(async () => {
  const existing = await chrome.tabs.query({ url: PAGE });
  if (existing.length) {
    await chrome.tabs.update(existing[0].id, { active: true });
    await chrome.windows.update(existing[0].windowId, { focused: true });
  } else {
    await chrome.tabs.create({ url: PAGE });
  }
});
