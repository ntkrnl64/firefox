/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const lazy = {};

ChromeUtils.defineESModuleGetters(lazy, {
  BookmarkHistoryTools:
    "chrome://remote/content/mcp/tools/BookmarkHistoryTools.sys.mjs",
  BrowserTools: "chrome://remote/content/mcp/tools/BrowserTools.sys.mjs",
  ContentTools: "chrome://remote/content/mcp/tools/ContentTools.sys.mjs",
  CookieTools: "chrome://remote/content/mcp/tools/CookieTools.sys.mjs",
  DebuggerTools: "chrome://remote/content/mcp/tools/DebuggerTools.sys.mjs",
  DevToolsTools: "chrome://remote/content/mcp/tools/DevToolsTools.sys.mjs",
  DrmTools: "chrome://remote/content/mcp/tools/DrmTools.sys.mjs",
  ElementTools: "chrome://remote/content/mcp/tools/ElementTools.sys.mjs",
  DownloadTools: "chrome://remote/content/mcp/tools/DownloadTools.sys.mjs",
  ExtensionTools: "chrome://remote/content/mcp/tools/ExtensionTools.sys.mjs",
  InspectTools: "chrome://remote/content/mcp/tools/InspectTools.sys.mjs",
  MediaTools: "chrome://remote/content/mcp/tools/MediaTools.sys.mjs",
  PermissionTools: "chrome://remote/content/mcp/tools/PermissionTools.sys.mjs",
  PrintTools: "chrome://remote/content/mcp/tools/PrintTools.sys.mjs",
  TabExtraTools: "chrome://remote/content/mcp/tools/TabExtraTools.sys.mjs",
  WindowTools: "chrome://remote/content/mcp/tools/WindowTools.sys.mjs",
  ZoomFindTools: "chrome://remote/content/mcp/tools/ZoomFindTools.sys.mjs",
});

/**
 *
 */
class McpToolRegistryClass {
  #toolMap = null;

  #ensureTools() {
    if (this.#toolMap) {
      return;
    }
    this.#toolMap = new Map();

    const modules = [
      lazy.BookmarkHistoryTools,
      lazy.BrowserTools,
      lazy.ContentTools,
      lazy.CookieTools,
      lazy.DebuggerTools,
      lazy.DevToolsTools,
      lazy.DrmTools,
      lazy.ElementTools,
      lazy.DownloadTools,
      lazy.ExtensionTools,
      lazy.InspectTools,
      lazy.MediaTools,
      lazy.PermissionTools,
      lazy.PrintTools,
      lazy.TabExtraTools,
      lazy.WindowTools,
      lazy.ZoomFindTools,
    ];

    for (const mod of modules) {
      for (const tool of mod.tools) {
        this.#toolMap.set(tool.name, tool);
      }
    }
  }

  listTools() {
    this.#ensureTools();
    const result = [];
    for (const tool of this.#toolMap.values()) {
      result.push({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
      });
    }
    return result;
  }

  async callTool(name, args) {
    this.#ensureTools();
    const tool = this.#toolMap.get(name);
    if (!tool) {
      throw new Error(`Unknown tool: ${name}`);
    }
    return tool.handler(args);
  }
}

export const McpToolRegistry = new McpToolRegistryClass();
