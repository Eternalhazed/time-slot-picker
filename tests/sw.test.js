import { createRequire } from "node:module";
import { afterEach, describe, expect, test, vi } from "vitest";

const require = createRequire(import.meta.url);

function resetServiceWorkerModule() {
  delete require.cache[require.resolve("../extension/sw.js")];
}

function bootServiceWorker(sendMessageImpl) {
  let clickListener = null;
  global.chrome = {
    action: {
      onClicked: {
        addListener: vi.fn((listener) => {
          clickListener = listener;
        })
      }
    },
    runtime: {
      lastError: null
    },
    scripting: {
      executeScript: vi.fn((_details, callback) => {
        if (callback) callback();
      }),
      insertCSS: vi.fn((_details, callback) => {
        if (callback) callback();
      })
    },
    tabs: {
      sendMessage: vi.fn(sendMessageImpl)
    }
  };

  resetServiceWorkerModule();
  require("../extension/sw.js");

  return {
    chrome: global.chrome,
    click: (tab) => clickListener(tab)
  };
}

afterEach(() => {
  resetServiceWorkerModule();
  delete global.chrome;
});

describe("service worker toolbar click", () => {
  test("injects the content stack when a Calendar tab has no receiving content script yet", () => {
    const { chrome, click } = bootServiceWorker((_tabId, _message, callback) => {
      chrome.runtime.lastError = { message: "Could not establish connection. Receiving end does not exist." };
      callback();
    });

    click({ id: 42, url: "https://calendar.google.com/calendar/u/0/r/week" });

    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(
      42,
      { type: "TSP_TOGGLE_SIDEBAR" },
      expect.any(Function)
    );
    expect(chrome.scripting.insertCSS).toHaveBeenCalledWith(
      {
        target: { tabId: 42 },
        files: ["sidebar.css"]
      },
      expect.any(Function)
    );
    expect(chrome.scripting.executeScript).toHaveBeenCalledWith(
      {
        target: { tabId: 42 },
        files: [
          "time-utils.js",
          "storage.js",
          "grid-anchor.js",
          "capture-overlay.js",
          "content.js"
        ]
      },
      expect.any(Function)
    );
    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(
      42,
      { type: "TSP_SHOW_SIDEBAR" },
      expect.any(Function)
    );
  });
});
