/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const lazy = {};

ChromeUtils.defineESModuleGetters(lazy, {
  Log: "chrome://remote/content/shared/Log.sys.mjs",
  McpToolRegistry: "chrome://remote/content/mcp/tools/McpToolRegistry.sys.mjs",
});

ChromeUtils.defineLazyGetter(lazy, "logger", () => lazy.Log.get());

export const MCP_PROTOCOL_VERSION = "2025-03-26";
export const MCP_SERVER_NAME = "firefox-mcp";
export const MCP_SERVER_VERSION = "1.0.0";

export const JSONRPC_VERSION = "2.0";

export const JSONRPC_ERRORS = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
};

// httpd.js's response.write() ultimately calls
// nsIOutputStream.write(string, string.length), which truncates each JS
// UTF-16 code unit to 8 bits. Any non-Latin-1 character (e.g. an em-dash,
// U+2014) gets corrupted into its low byte (0x14), producing invalid JSON.
// Pre-encode to UTF-8 and pack the bytes into a string of code units 0-255
// so the truncation in httpd is a no-op and the correct bytes reach the wire.
export function writeUtf8(response, str) {
  const bytes = new TextEncoder().encode(String(str));
  const CHUNK = 0x8000;
  let out = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    out += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  response.write(out);
}

/**
 * Shared dispatch logic for both WebSocket and SSE transports.
 */
export const McpDispatch = {
  handleNotification(method) {
    switch (method) {
      case "notifications/initialized":
        lazy.logger.debug("MCP client initialized");
        return true;
      case "notifications/cancelled":
        return true;
      default:
        lazy.logger.debug(`MCP: Unknown notification: ${method}`);
        return false;
    }
  },

  async dispatch(method, params) {
    switch (method) {
      case "initialize":
        return this.handleInitialize(params);
      case "ping":
        return {};
      case "tools/list":
        return this.handleToolsList();
      case "tools/call":
        return this.handleToolsCall(params);
      case "resources/list":
        return { resources: [] };
      case "resources/read": {
        const err = new Error(`Resource not found: ${params?.uri}`);
        err.jsonrpcCode = JSONRPC_ERRORS.INVALID_PARAMS;
        throw err;
      }
      default: {
        const err = new Error(`Unknown method: ${method}`);
        err.jsonrpcCode = JSONRPC_ERRORS.METHOD_NOT_FOUND;
        throw err;
      }
    }
  },

  handleInitialize(params) {
    const clientInfo = params?.clientInfo || {};
    lazy.logger.info(
      `MCP: Client "${clientInfo.name || "unknown"}" v${clientInfo.version || "?"} connecting`
    );

    return {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {
        tools: { listChanged: false },
        resources: { subscribe: false, listChanged: false },
      },
      serverInfo: {
        name: MCP_SERVER_NAME,
        version: MCP_SERVER_VERSION,
      },
    };
  },

  handleToolsList() {
    return {
      tools: lazy.McpToolRegistry.listTools(),
    };
  },

  async handleToolsCall(params) {
    const { name, arguments: args } = params;
    if (!name) {
      const err = new Error("Missing tool name");
      err.jsonrpcCode = JSONRPC_ERRORS.INVALID_PARAMS;
      throw err;
    }

    try {
      const result = await lazy.McpToolRegistry.callTool(name, args || {});
      return {
        content: Array.isArray(result)
          ? result
          : [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    } catch (e) {
      return {
        content: [{ type: "text", text: `Error: ${e.message}` }],
        isError: true,
      };
    }
  },
};
