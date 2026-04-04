/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const lazy = {};

ChromeUtils.defineESModuleGetters(lazy, {
  capture: "chrome://remote/content/shared/Capture.sys.mjs",
  TabManager: "chrome://remote/content/shared/TabManager.sys.mjs",
});

function getActiveTab() {
  const win = Services.wm.getMostRecentBrowserWindow();
  if (!win?.gBrowser) {
    throw new Error("No browser window available");
  }
  return win.gBrowser.selectedTab;
}

function getActiveBrowser() {
  const tab = getActiveTab();
  const browser = lazy.TabManager.getBrowserForTab(tab);
  if (!browser) {
    throw new Error("No active browser element");
  }
  return browser;
}

function getTabByIndex(index) {
  const tabs = lazy.TabManager.allTabs;
  if (index < 0 || index >= tabs.length) {
    throw new Error(`Tab index ${index} out of range (0-${tabs.length - 1})`);
  }
  return tabs[index];
}

function tabToInfo(tab, index) {
  const browser = lazy.TabManager.getBrowserForTab(tab);
  return {
    index,
    url: browser?.currentURI?.spec || "about:blank",
    title: tab.label || "",
    active: tab === tab.ownerGlobal?.gBrowser?.selectedTab,
  };
}

async function navigate(args) {
  const { url } = args;
  if (!url) {
    throw new Error("url is required");
  }

  const browser = getActiveBrowser();
  const loadURIOptions = {
    triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
  };

  browser.fixupAndLoadURIString(url, loadURIOptions);

  await new Promise(resolve => {
    const listener = {
      onStateChange(webProgress, request, flags) {
        if (
          flags & Ci.nsIWebProgressListener.STATE_STOP &&
          flags & Ci.nsIWebProgressListener.STATE_IS_NETWORK
        ) {
          browser.removeProgressListener(listener);
          resolve();
        }
      },
      QueryInterface: ChromeUtils.generateQI([
        "nsIWebProgressListener",
        "nsISupportsWeakReference",
      ]),
    };
    browser.addProgressListener(
      listener,
      Ci.nsIWebProgress.NOTIFY_STATE_NETWORK
    );
  });

  return [{ type: "text", text: `Navigated to ${browser.currentURI.spec}` }];
}

async function goBack() {
  const browser = getActiveBrowser();
  if (browser.canGoBack) {
    browser.goBack();
    return [{ type: "text", text: "Navigated back" }];
  }
  return [{ type: "text", text: "Cannot go back, already at first page" }];
}

async function goForward() {
  const browser = getActiveBrowser();
  if (browser.canGoForward) {
    browser.goForward();
    return [{ type: "text", text: "Navigated forward" }];
  }
  return [{ type: "text", text: "Cannot go forward, already at last page" }];
}

async function reload() {
  const browser = getActiveBrowser();
  browser.reload();
  return [{ type: "text", text: "Page reloaded" }];
}

async function listTabs() {
  const tabs = lazy.TabManager.allTabs;
  const result = tabs.map((tab, i) => tabToInfo(tab, i));
  return [{ type: "text", text: JSON.stringify(result, null, 2) }];
}

async function newTab(args) {
  const { url, focus = true } = args;
  const tab = await lazy.TabManager.addTab({ focus });

  if (url) {
    const browser = lazy.TabManager.getBrowserForTab(tab);
    browser.fixupAndLoadURIString(url, {
      triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
    });
  }

  const tabs = lazy.TabManager.allTabs;
  const index = tabs.indexOf(tab);
  return [
    { type: "text", text: JSON.stringify(tabToInfo(tab, index), null, 2) },
  ];
}

async function closeTab(args) {
  const { index } = args;
  let tab;
  if (index !== undefined && index !== null) {
    tab = getTabByIndex(index);
  } else {
    tab = getActiveTab();
  }
  await lazy.TabManager.removeTab(tab, { skipPermitUnload: true });
  return [{ type: "text", text: "Tab closed" }];
}

async function switchTab(args) {
  const { index } = args;
  if (index === undefined || index === null) {
    throw new Error("index is required");
  }
  const tab = getTabByIndex(index);
  await lazy.TabManager.selectTab(tab);
  return [
    { type: "text", text: JSON.stringify(tabToInfo(tab, index), null, 2) },
  ];
}

async function screenshot(args) {
  const { fullPage = false } = args;
  const browser = getActiveBrowser();
  const browsingContext = browser.browsingContext;
  const win = browser.ownerGlobal;

  let rect;
  if (fullPage) {
    const scrollWidth = browsingContext.currentWindowContext.documentPrincipal
      ? browser.contentDocument?.documentElement?.scrollWidth || win.innerWidth
      : win.innerWidth;
    const scrollHeight = browsingContext.currentWindowContext.documentPrincipal
      ? browser.contentDocument?.documentElement?.scrollHeight ||
        win.innerHeight
      : win.innerHeight;
    rect = new DOMRect(0, 0, scrollWidth, scrollHeight);
  } else {
    rect = new DOMRect(
      0,
      0,
      browsingContext.currentWindowContext?.innerWindowWidth || win.innerWidth,
      browsingContext.currentWindowContext?.innerWindowHeight || win.innerHeight
    );
  }

  const canvas = await lazy.capture.canvas(
    win,
    browsingContext,
    rect.x,
    rect.y,
    rect.width,
    rect.height,
    { readback: true }
  );

  const dataUrl = canvas.toDataURL("image/png");
  const base64 = dataUrl.replace(/^data:image\/png;base64,/, "");
  return [{ type: "image", data: base64, mimeType: "image/png" }];
}

async function getUrl() {
  const browser = getActiveBrowser();
  return [{ type: "text", text: browser.currentURI.spec }];
}

async function getTitle() {
  const tab = getActiveTab();
  return [{ type: "text", text: tab.label || "" }];
}

export const BrowserTools = {
  tools: [
    {
      name: "browser_navigate",
      description: "Navigate the active tab to a URL",
      inputSchema: {
        type: "object",
        properties: {
          url: { type: "string", description: "The URL to navigate to" },
        },
        required: ["url"],
      },
      handler: navigate,
    },
    {
      name: "browser_back",
      description: "Navigate the active tab back in history",
      inputSchema: { type: "object", properties: {} },
      handler: goBack,
    },
    {
      name: "browser_forward",
      description: "Navigate the active tab forward in history",
      inputSchema: { type: "object", properties: {} },
      handler: goForward,
    },
    {
      name: "browser_reload",
      description: "Reload the active tab",
      inputSchema: { type: "object", properties: {} },
      handler: reload,
    },
    {
      name: "browser_list_tabs",
      description: "List all open tabs with their URLs, titles, and indices",
      inputSchema: { type: "object", properties: {} },
      handler: listTabs,
    },
    {
      name: "browser_new_tab",
      description: "Open a new browser tab, optionally navigating to a URL",
      inputSchema: {
        type: "object",
        properties: {
          url: { type: "string", description: "URL to open in the new tab" },
          focus: {
            type: "boolean",
            description: "Whether to focus the new tab (default: true)",
          },
        },
      },
      handler: newTab,
    },
    {
      name: "browser_close_tab",
      description: "Close a tab by index, or the active tab if no index given",
      inputSchema: {
        type: "object",
        properties: {
          index: { type: "integer", description: "Tab index to close" },
        },
      },
      handler: closeTab,
    },
    {
      name: "browser_switch_tab",
      description: "Switch to a tab by index",
      inputSchema: {
        type: "object",
        properties: {
          index: { type: "integer", description: "Tab index to switch to" },
        },
        required: ["index"],
      },
      handler: switchTab,
    },
    {
      name: "browser_screenshot",
      description:
        "Take a screenshot of the active tab. Returns base64-encoded PNG image.",
      inputSchema: {
        type: "object",
        properties: {
          fullPage: {
            type: "boolean",
            description:
              "Capture full page including scrollable area (default: false)",
          },
        },
      },
      handler: screenshot,
    },
    {
      name: "browser_get_url",
      description: "Get the URL of the active tab",
      inputSchema: { type: "object", properties: {} },
      handler: getUrl,
    },
    {
      name: "browser_get_title",
      description: "Get the title of the active tab",
      inputSchema: { type: "object", properties: {} },
      handler: getTitle,
    },
  ],
};
