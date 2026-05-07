chrome.action.onClicked.addListener((tab) => {
  if (!tab || !tab.id) {
    return;
  }

  chrome.tabs.sendMessage(tab.id, { type: "TSP_TOGGLE_SIDEBAR" }, () => {
    void chrome.runtime.lastError;
  });
});
