/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const lazy = {};

ChromeUtils.defineESModuleGetters(lazy, {
  windowManager: "chrome://remote/content/shared/WindowManager.sys.mjs",
});

function getActiveWindow() {
  const win = Services.wm.getMostRecentBrowserWindow();
  if (!win) {
    throw new Error("No browser window available");
  }
  return win;
}

function windowToJSON(win, index) {
  return {
    index,
    title: win.document?.title || "",
    isPrivate:
      win.gBrowser?.selectedBrowser?.browsingContext?.usePrivateBrowsing ??
      false,
    tabCount: win.gBrowser?.tabs?.length || 0,
    focused: win === Services.wm.getMostRecentBrowserWindow(),
    outerWidth: win.outerWidth,
    outerHeight: win.outerHeight,
    screenX: win.screenX,
    screenY: win.screenY,
  };
}

async function listWindows() {
  const windows = [];
  let index = 0;
  for (const win of lazy.windowManager.windows) {
    windows.push(windowToJSON(win, index++));
  }
  return [{ type: "text", text: JSON.stringify(windows, null, 2) }];
}

async function newWindow(args) {
  const { private: isPrivate = false, url } = args;

  const win = getActiveWindow();
  const features = isPrivate
    ? "chrome,all,dialog=no,private"
    : "chrome,all,dialog=no";
  const newWin = win.openDialog(
    "chrome://browser/content/browser.xhtml",
    "_blank",
    features,
    url || "about:blank"
  );

  await new Promise(resolve => {
    newWin.addEventListener("load", resolve, { once: true });
  });

  return [
    {
      type: "text",
      text: JSON.stringify(
        {
          message: isPrivate
            ? "New private window opened"
            : "New window opened",
          url: url || "about:blank",
        },
        null,
        2
      ),
    },
  ];
}

async function closeWindow(args) {
  const { index } = args;
  let win;
  if (index !== undefined && index !== null) {
    const windows = Array.from(lazy.windowManager.windows);
    if (index < 0 || index >= windows.length) {
      throw new Error(`Window index ${index} out of range`);
    }
    win = windows[index];
  } else {
    win = getActiveWindow();
  }

  win.close();
  return [{ type: "text", text: "Window closed" }];
}

async function focusWindow(args) {
  const { index } = args;
  if (index === undefined || index === null) {
    throw new Error("index is required");
  }

  const windows = Array.from(lazy.windowManager.windows);
  if (index < 0 || index >= windows.length) {
    throw new Error(`Window index ${index} out of range`);
  }

  windows[index].focus();
  return [{ type: "text", text: `Focused window ${index}` }];
}

async function setFullscreen(args) {
  const { enabled = true } = args;
  const win = getActiveWindow();
  if (enabled && !win.fullScreen) {
    win.fullScreen = true;
    return [{ type: "text", text: "Entered fullscreen" }];
  } else if (!enabled && win.fullScreen) {
    win.fullScreen = false;
    return [{ type: "text", text: "Exited fullscreen" }];
  }
  return [
    { type: "text", text: `Fullscreen already ${enabled ? "on" : "off"}` },
  ];
}

async function resizeWindow(args) {
  const { width, height } = args;
  const win = getActiveWindow();
  if (width !== undefined && height !== undefined) {
    win.resizeTo(width, height);
  } else if (width !== undefined) {
    win.resizeTo(width, win.outerHeight);
  } else if (height !== undefined) {
    win.resizeTo(win.outerWidth, height);
  }
  return [
    {
      type: "text",
      text: `Window resized to ${win.outerWidth}x${win.outerHeight}`,
    },
  ];
}

async function moveWindow(args) {
  const { x, y } = args;
  const win = getActiveWindow();
  win.moveTo(x ?? win.screenX, y ?? win.screenY);
  return [
    { type: "text", text: `Window moved to (${win.screenX}, ${win.screenY})` },
  ];
}

export const WindowTools = {
  tools: [
    {
      name: "window_list",
      description: "List all open browser windows",
      inputSchema: { type: "object", properties: {} },
      handler: listWindows,
    },
    {
      name: "window_new",
      description: "Open a new browser window (optionally private)",
      inputSchema: {
        type: "object",
        properties: {
          private: {
            type: "boolean",
            description: "Open a private window (default: false)",
          },
          url: { type: "string", description: "URL to open in the new window" },
        },
      },
      handler: newWindow,
    },
    {
      name: "window_close",
      description: "Close a browser window by index, or the active window",
      inputSchema: {
        type: "object",
        properties: {
          index: { type: "integer", description: "Window index to close" },
        },
      },
      handler: closeWindow,
    },
    {
      name: "window_focus",
      description: "Focus a browser window by index",
      inputSchema: {
        type: "object",
        properties: {
          index: { type: "integer", description: "Window index to focus" },
        },
        required: ["index"],
      },
      handler: focusWindow,
    },
    {
      name: "window_fullscreen",
      description: "Enter or exit fullscreen mode",
      inputSchema: {
        type: "object",
        properties: {
          enabled: {
            type: "boolean",
            description: "true to enter, false to exit fullscreen",
          },
        },
      },
      handler: setFullscreen,
    },
    {
      name: "window_resize",
      description: "Resize the active browser window",
      inputSchema: {
        type: "object",
        properties: {
          width: { type: "integer", description: "Window width in pixels" },
          height: { type: "integer", description: "Window height in pixels" },
        },
      },
      handler: resizeWindow,
    },
    {
      name: "window_move",
      description: "Move the active browser window",
      inputSchema: {
        type: "object",
        properties: {
          x: { type: "integer", description: "Screen X position" },
          y: { type: "integer", description: "Screen Y position" },
        },
      },
      handler: moveWindow,
    },
  ],
};
