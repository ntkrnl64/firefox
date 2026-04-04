/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

function getActiveWindow() {
  const win = Services.wm.getMostRecentBrowserWindow();
  if (!win?.gBrowser) {
    throw new Error("No browser window available");
  }
  return win;
}

function getActiveBrowser() {
  return getActiveWindow().gBrowser.selectedBrowser;
}

async function zoomIn() {
  const win = getActiveWindow();
  win.ZoomManager.enlarge();
  return [
    { type: "text", text: `Zoom: ${Math.round(win.ZoomManager.zoom * 100)}%` },
  ];
}

async function zoomOut() {
  const win = getActiveWindow();
  win.ZoomManager.reduce();
  return [
    { type: "text", text: `Zoom: ${Math.round(win.ZoomManager.zoom * 100)}%` },
  ];
}

async function zoomReset() {
  const win = getActiveWindow();
  win.ZoomManager.zoom = 1.0;
  return [{ type: "text", text: "Zoom reset to 100%" }];
}

async function zoomSet(args) {
  const { level } = args;
  if (level === undefined) {
    throw new Error("level is required");
  }
  const win = getActiveWindow();
  win.ZoomManager.zoom = level / 100;
  return [{ type: "text", text: `Zoom set to ${level}%` }];
}

async function zoomGet() {
  const win = getActiveWindow();
  return [{ type: "text", text: `${Math.round(win.ZoomManager.zoom * 100)}` }];
}

async function findText(args) {
  const { text, caseSensitive = false, highlightAll = true } = args;
  if (!text) {
    throw new Error("text is required");
  }

  const win = getActiveWindow();

  // Open the find bar if needed.
  await win.gBrowser.getFindBar(true);
  const findBar = win.gBrowser.getCachedFindBar();

  if (findBar) {
    findBar.open();
    findBar._findField.value = text;
    findBar._setCaseSensitivity(caseSensitive ? 1 : 0);
    findBar._setHighlightAll(highlightAll);

    // Trigger the search.
    findBar._find(text);
    return [{ type: "text", text: `Find initiated for "${text}"` }];
  }

  // Fallback: use the Finder API directly.
  const browser = getActiveBrowser();
  if (browser.finder) {
    browser.finder.caseSensitive = caseSensitive;
    browser.finder.highlight(highlightAll, text, false);
    const result = await new Promise(resolve => {
      const listener = {
        onFindResult(data) {
          browser.finder.removeResultListener(listener);
          resolve(data);
        },
      };
      browser.finder.addResultListener(listener);
      browser.finder.fastFind(text, false, false);
    });
    return [
      {
        type: "text",
        text: JSON.stringify({
          found: result.result !== Ci.nsITypeAheadFind.FIND_NOTFOUND,
          text,
        }),
      },
    ];
  }

  throw new Error("Find functionality not available");
}

async function findNext() {
  const browser = getActiveBrowser();
  if (browser.finder) {
    browser.finder.findAgain(Ci.nsITypeAheadFind.FIND_FORWARD, false, false);
    return [{ type: "text", text: "Find next" }];
  }
  return [{ type: "text", text: "No active find session" }];
}

async function findPrevious() {
  const browser = getActiveBrowser();
  if (browser.finder) {
    browser.finder.findAgain(Ci.nsITypeAheadFind.FIND_BACKWARD, false, false);
    return [{ type: "text", text: "Find previous" }];
  }
  return [{ type: "text", text: "No active find session" }];
}

async function findClose() {
  const win = getActiveWindow();
  const findBar = win.gBrowser.getCachedFindBar();
  if (findBar) {
    findBar.close();
  }
  const browser = getActiveBrowser();
  if (browser.finder) {
    browser.finder.highlight(false, "", false);
  }
  return [{ type: "text", text: "Find bar closed" }];
}

async function viewPageSource() {
  const browser = getActiveBrowser();
  const url = browser.currentURI.spec;
  const win = getActiveWindow();
  win.BrowserViewSource(browser);
  return [{ type: "text", text: `Viewing source of ${url}` }];
}

export const ZoomFindTools = {
  tools: [
    {
      name: "zoom_in",
      description: "Zoom in on the active tab",
      inputSchema: { type: "object", properties: {} },
      handler: zoomIn,
    },
    {
      name: "zoom_out",
      description: "Zoom out on the active tab",
      inputSchema: { type: "object", properties: {} },
      handler: zoomOut,
    },
    {
      name: "zoom_reset",
      description: "Reset zoom to 100%",
      inputSchema: { type: "object", properties: {} },
      handler: zoomReset,
    },
    {
      name: "zoom_set",
      description: "Set zoom level to a specific percentage",
      inputSchema: {
        type: "object",
        properties: {
          level: {
            type: "integer",
            description: "Zoom percentage (e.g. 150 for 150%)",
          },
        },
        required: ["level"],
      },
      handler: zoomSet,
    },
    {
      name: "zoom_get",
      description: "Get the current zoom level percentage",
      inputSchema: { type: "object", properties: {} },
      handler: zoomGet,
    },
    {
      name: "find_text",
      description: "Find text on the current page (like Ctrl+F)",
      inputSchema: {
        type: "object",
        properties: {
          text: { type: "string", description: "Text to search for" },
          caseSensitive: {
            type: "boolean",
            description: "Case-sensitive search (default: false)",
          },
          highlightAll: {
            type: "boolean",
            description: "Highlight all matches (default: true)",
          },
        },
        required: ["text"],
      },
      handler: findText,
    },
    {
      name: "find_next",
      description: "Find the next occurrence of the search text",
      inputSchema: { type: "object", properties: {} },
      handler: findNext,
    },
    {
      name: "find_previous",
      description: "Find the previous occurrence of the search text",
      inputSchema: { type: "object", properties: {} },
      handler: findPrevious,
    },
    {
      name: "find_close",
      description: "Close the find bar and clear highlights",
      inputSchema: { type: "object", properties: {} },
      handler: findClose,
    },
    {
      name: "page_view_source",
      description: "Open the page source viewer for the active tab",
      inputSchema: { type: "object", properties: {} },
      handler: viewPageSource,
    },
  ],
};
