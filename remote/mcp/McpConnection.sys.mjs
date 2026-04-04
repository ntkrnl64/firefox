/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { WebSocketConnection } from "chrome://remote/content/shared/WebSocketConnection.sys.mjs";

const lazy = {};

ChromeUtils.defineESModuleGetters(lazy, {
  JSONRPC_ERRORS: "chrome://remote/content/mcp/McpDispatch.sys.mjs",
  JSONRPC_VERSION: "chrome://remote/content/mcp/McpDispatch.sys.mjs",
  Log: "chrome://remote/content/shared/Log.sys.mjs",
  McpDispatch: "chrome://remote/content/mcp/McpDispatch.sys.mjs",
});

ChromeUtils.defineLazyGetter(lazy, "logger", () => lazy.Log.get());

/**
 *
 */
export class McpConnection extends WebSocketConnection {
  #mcpServer;

  constructor(webSocket, httpdConnection, mcpServer) {
    super(webSocket, httpdConnection);
    this.#mcpServer = mcpServer;
  }

  sendResult(id, result) {
    this.send({
      jsonrpc: lazy.JSONRPC_VERSION,
      id,
      result,
    });
  }

  sendError(id, code, message, data) {
    const error = { code, message };
    if (data !== undefined) {
      error.data = data;
    }
    this.send({
      jsonrpc: lazy.JSONRPC_VERSION,
      id,
      error,
    });
  }

  onConnectionClose() {
    this.#mcpServer.removeConnection(this);
    super.onConnectionClose();
  }

  async onPacket(packet) {
    super.onPacket(packet);

    const { jsonrpc, id, method, params } = packet;

    if (id === undefined || id === null) {
      lazy.McpDispatch.handleNotification(method, params);
      return;
    }

    if (jsonrpc !== lazy.JSONRPC_VERSION) {
      this.sendError(
        id,
        lazy.JSONRPC_ERRORS.INVALID_REQUEST,
        "Invalid JSON-RPC version"
      );
      return;
    }

    if (typeof method !== "string") {
      this.sendError(
        id,
        lazy.JSONRPC_ERRORS.INVALID_REQUEST,
        "Missing or invalid method"
      );
      return;
    }

    try {
      const result = await lazy.McpDispatch.dispatch(method, params || {});
      this.sendResult(id, result);
    } catch (e) {
      lazy.logger.debug(`MCP error for ${method}: ${e.message}`);
      if (e.jsonrpcCode) {
        this.sendError(id, e.jsonrpcCode, e.message);
      } else {
        this.sendError(id, lazy.JSONRPC_ERRORS.INTERNAL_ERROR, e.message);
      }
    }
  }
}
