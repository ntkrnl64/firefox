/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const lazy = {};

ChromeUtils.defineESModuleGetters(lazy, {
  TabManager: "chrome://remote/content/shared/TabManager.sys.mjs",
});

function getActiveWindow() {
  const win = Services.wm.getMostRecentBrowserWindow();
  if (!win?.gBrowser) {
    throw new Error("No browser window available");
  }
  return win;
}

function getTab(index) {
  if (index !== undefined && index !== null) {
    const tabs = lazy.TabManager.allTabs;
    if (index < 0 || index >= tabs.length) {
      throw new Error(`Tab index ${index} out of range`);
    }
    return tabs[index];
  }
  return getActiveWindow().gBrowser.selectedTab;
}

async function pinTab(args) {
  const { index } = args;
  const win = getActiveWindow();
  const tab = getTab(index);
  win.gBrowser.pinTab(tab);
  return [{ type: "text", text: "Tab pinned" }];
}

async function unpinTab(args) {
  const { index } = args;
  const win = getActiveWindow();
  const tab = getTab(index);
  win.gBrowser.unpinTab(tab);
  return [{ type: "text", text: "Tab unpinned" }];
}

async function duplicateTab(args) {
  const { index } = args;
  const win = getActiveWindow();
  const tab = getTab(index);
  const newTab = win.gBrowser.duplicateTab(tab);
  return [
    {
      type: "text",
      text: `Tab duplicated (new tab at index ${Array.from(win.gBrowser.tabs).indexOf(newTab)})`,
    },
  ];
}

async function muteTab(args) {
  const { index } = args;
  const tab = getTab(index);
  tab.toggleMuteAudio();
  const muted = tab.linkedBrowser?.audioMuted;
  return [{ type: "text", text: muted ? "Tab muted" : "Tab unmuted" }];
}

async function moveTab(args) {
  const { fromIndex, toIndex } = args;
  if (fromIndex === undefined) {
    throw new Error("fromIndex is required");
  }
  if (toIndex === undefined) {
    throw new Error("toIndex is required");
  }

  const win = getActiveWindow();
  win.gBrowser.moveTabTo(getTab(fromIndex), toIndex);
  return [{ type: "text", text: `Tab moved from ${fromIndex} to ${toIndex}` }];
}

async function getTabInfo(args) {
  const { index } = args;
  const tab = getTab(index);
  const browser = lazy.TabManager.getBrowserForTab(tab);
  const win = lazy.TabManager.getWindowForTab(tab);
  const tabBrowser = lazy.TabManager.getTabBrowser(win);

  return [
    {
      type: "text",
      text: JSON.stringify(
        {
          url: browser?.currentURI?.spec || "about:blank",
          title: tab.label || "",
          pinned: tab.pinned,
          muted: browser?.audioMuted || false,
          playing: tab.soundPlaying || false,
          active: tab === tabBrowser?.selectedTab,
          index: Array.from(tabBrowser?.tabs || []).indexOf(tab),
          loading: tab.getAttribute("busy") === "true",
          discarded: tab.linkedPanel === "",
        },
        null,
        2
      ),
    },
  ];
}

export const TabExtraTools = {
  tools: [
    {
      name: "tab_pin",
      description: "Pin a tab",
      inputSchema: {
        type: "object",
        properties: {
          index: {
            type: "integer",
            description: "Tab index (default: active tab)",
          },
        },
      },
      handler: pinTab,
    },
    {
      name: "tab_unpin",
      description: "Unpin a tab",
      inputSchema: {
        type: "object",
        properties: {
          index: {
            type: "integer",
            description: "Tab index (default: active tab)",
          },
        },
      },
      handler: unpinTab,
    },
    {
      name: "tab_duplicate",
      description: "Duplicate a tab",
      inputSchema: {
        type: "object",
        properties: {
          index: {
            type: "integer",
            description: "Tab index to duplicate (default: active tab)",
          },
        },
      },
      handler: duplicateTab,
    },
    {
      name: "tab_mute",
      description: "Toggle mute on a tab",
      inputSchema: {
        type: "object",
        properties: {
          index: {
            type: "integer",
            description: "Tab index (default: active tab)",
          },
        },
      },
      handler: muteTab,
    },
    {
      name: "tab_move",
      description: "Move a tab to a new position",
      inputSchema: {
        type: "object",
        properties: {
          fromIndex: { type: "integer", description: "Current tab index" },
          toIndex: { type: "integer", description: "Target position" },
        },
        required: ["fromIndex", "toIndex"],
      },
      handler: moveTab,
    },
    {
      name: "tab_info",
      description:
        "Get detailed info about a tab (pinned, muted, loading, etc.)",
      inputSchema: {
        type: "object",
        properties: {
          index: {
            type: "integer",
            description: "Tab index (default: active tab)",
          },
        },
      },
      handler: getTabInfo,
    },
  ],
};
