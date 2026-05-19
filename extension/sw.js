const CONTENT_SCRIPT_FILES = [
  "time-utils.js",
  "storage.js",
  "grid-anchor.js",
  "capture-overlay.js",
  "content.js"
];
const CONTENT_CSS_FILES = ["sidebar.css"];

function isCalendarTab(tab) {
  return Boolean(tab && tab.id && /^https:\/\/calendar\.google\.com\//.test(tab.url || ""));
}

function isMissingReceiver(error) {
  const message = error && error.message ? error.message : "";
  return /receiving end does not exist|could not establish connection/i.test(message);
}

function showSidebar(tabId) {
  chrome.tabs.sendMessage(tabId, { type: "TSP_SHOW_SIDEBAR" }, () => {
    void chrome.runtime.lastError;
  });
}

function injectContentStack(tabId) {
  chrome.scripting.insertCSS(
    { target: { tabId }, files: CONTENT_CSS_FILES },
    () => {
      void chrome.runtime.lastError;
      chrome.scripting.executeScript(
        { target: { tabId }, files: CONTENT_SCRIPT_FILES },
        () => {
          void chrome.runtime.lastError;
          showSidebar(tabId);
        }
      );
    }
  );
}

chrome.action.onClicked.addListener((tab) => {
  if (!tab || !tab.id) {
    return;
  }

  chrome.tabs.sendMessage(tab.id, { type: "TSP_TOGGLE_SIDEBAR" }, () => {
    const error = chrome.runtime.lastError;
    if (error && isMissingReceiver(error) && isCalendarTab(tab) && chrome.scripting) {
      injectContentStack(tab.id);
    }
  });
});
