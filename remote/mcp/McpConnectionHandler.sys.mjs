/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const lazy = {};

ChromeUtils.defineESModuleGetters(lazy, {
  Log: "chrome://remote/content/shared/Log.sys.mjs",
  McpConnection: "chrome://remote/content/mcp/McpConnection.sys.mjs",
  McpSseConnection: "chrome://remote/content/mcp/McpSseConnection.sys.mjs",
  WebSocketHandshake:
    "chrome://remote/content/server/WebSocketHandshake.sys.mjs",
  writeUtf8: "chrome://remote/content/mcp/McpDispatch.sys.mjs",
});

ChromeUtils.defineLazyGetter(lazy, "logger", () => lazy.Log.get());

/**
 * HTTP request handler for /mcp that supports both transports:
 *
 * 1. WebSocket  - client sends `Upgrade: websocket` header
 * 2. Streamable HTTP (SSE) - client uses POST/GET/DELETE
 */
export class McpConnectionHandler {
  #server;
  #sseSessions;

  constructor(server) {
    this.#server = server;
    this.#sseSessions = new Map();
  }

  async handle(request, response) {
    // Check for WebSocket upgrade.
    let upgradeHeader;
    try {
      upgradeHeader = request.getHeader("Upgrade");
    } catch {
      // No Upgrade header.
    }

    if (upgradeHeader?.toLowerCase() === "websocket") {
      return this.#handleWebSocket(request, response);
    }

    // Streamable HTTP transport.
    const method = request.method;

    switch (method) {
      case "POST":
        return this.#handlePost(request, response);
      case "GET":
        return this.#handleGet(request, response);
      case "DELETE":
        return this.#handleDelete(request, response);
      case "OPTIONS":
        return this.#handleOptions(request, response);
      default:
        response.setStatusLine(request.httpVersion, 405, "Method Not Allowed");
        response.setHeader("Allow", "GET, POST, DELETE, OPTIONS", false);
        return undefined;
    }
  }

  /**
   * Close all SSE sessions (called on server shutdown).
   */
  closeAllSseSessions() {
    for (const session of this.#sseSessions.values()) {
      session.close();
    }
    this.#sseSessions.clear();
  }

  // -- WebSocket transport --

  async #handleWebSocket(request, response) {
    const webSocket = await lazy.WebSocketHandshake.upgrade(request, response);
    const conn = new lazy.McpConnection(
      webSocket,
      response._connection,
      this.#server
    );
    this.#server.addConnection(conn);
  }

  // -- Streamable HTTP / SSE transport --

  async #handlePost(request, response) {
    // Allow async processing for SSE responses.
    response.processAsync();

    this.#setCorsHeaders(response);

    lazy.logger.debug(
      `MCP SSE POST: queryString="${request.queryString || ""}", ` +
        `hasSessionHeader=${(() => { try { return !!request.getHeader("Mcp-Session-Id"); } catch { return false; } })()}`
    );

    let sessionId;
    let legacyTransport = false;
    try {
      sessionId = request.getHeader("Mcp-Session-Id");
    } catch {
      // No session header - check query string (legacy SSE transport).
    }
    if (!sessionId) {
      try {
        const qs = request.queryString || "";
        const params = new URLSearchParams(qs);
        sessionId = params.get("sessionId");
        if (sessionId) {
          legacyTransport = true;
        }
      } catch {
        // No query string.
      }
    }

    let session;

    if (sessionId) {
      session = this.#sseSessions.get(sessionId);
      if (!session) {
        // Unknown session ID.
        response.setStatusLine(request.httpVersion, 404, "Not Found");
        lazy.writeUtf8(
          response,
          JSON.stringify({
            jsonrpc: "2.0",
            error: { code: -32600, message: "Session not found" },
          })
        );
        response.finish();
        return;
      }
    } else {
      // Create a new session for the initialize request.
      session = new lazy.McpSseConnection();
      this.#sseSessions.set(session.id, session);
      this.#server.addConnection(session);
      lazy.logger.debug(`MCP SSE: New session ${session.id}`);
    }

    try {
      await session.handlePost(request, response, { legacyTransport });
    } catch (e) {
      lazy.logger.error(`MCP SSE POST error: ${e.message}`, e);
      try {
        response.setStatusLine(
          request.httpVersion,
          500,
          "Internal Server Error"
        );
        lazy.writeUtf8(
          response,
          JSON.stringify({
            jsonrpc: "2.0",
            error: { code: -32603, message: e.message },
          })
        );
      } catch {
        // Response may already be sent.
      }
    }

    try {
      response.finish();
    } catch {
      // Already finished (e.g. by SSE response path).
    }
  }

  #handleGet(request, response) {
    this.#setCorsHeaders(response);

    let accept;
    try {
      accept = request.getHeader("Accept");
    } catch {
      accept = "";
    }

    if (!accept.includes("text/event-stream")) {
      response.setStatusLine(request.httpVersion, 406, "Not Acceptable");
      response.write("Accept: text/event-stream required");
      return;
    }

    let sessionId;
    try {
      sessionId = request.getHeader("Mcp-Session-Id");
    } catch {
      // No session.
    }

    let session;
    if (sessionId) {
      session = this.#sseSessions.get(sessionId);
      if (!session) {
        response.setStatusLine(request.httpVersion, 404, "Not Found");
        response.write("Session not found");
        return;
      }
    } else {
      // Create a new session for SSE-first connections (e.g. Claude Code).
      session = new lazy.McpSseConnection();
      this.#sseSessions.set(session.id, session);
      this.#server.addConnection(session);
      lazy.logger.debug(`MCP SSE: New session (GET) ${session.id}`);
    }

    // Expose the session ID so the client can use it for POSTs.
    response.setHeader("Mcp-Session-Id", session.id, false);

    // Keep connection open for server-initiated events.
    session.handleGet(request, response);
  }

  #handleDelete(request, response) {
    this.#setCorsHeaders(response);

    let sessionId;
    try {
      sessionId = request.getHeader("Mcp-Session-Id");
    } catch {
      // No session.
    }

    if (!sessionId) {
      response.setStatusLine(request.httpVersion, 400, "Bad Request");
      return;
    }

    const session = this.#sseSessions.get(sessionId);
    if (!session) {
      response.setStatusLine(request.httpVersion, 404, "Not Found");
      return;
    }

    session.close();
    this.#sseSessions.delete(sessionId);
    this.#server.removeConnection(session);

    response.setStatusLine(request.httpVersion, 200, "OK");
    lazy.logger.debug(`MCP SSE: Session ${sessionId} terminated`);
  }

  #handleOptions(request, response) {
    this.#setCorsHeaders(response);
    response.setStatusLine(request.httpVersion, 204, "No Content");
    response.setHeader("Allow", "GET, POST, DELETE, OPTIONS", false);
  }

  #setCorsHeaders(response) {
    response.setHeader("Access-Control-Allow-Origin", "*", false);
    response.setHeader(
      "Access-Control-Allow-Methods",
      "GET, POST, DELETE, OPTIONS",
      false
    );
    response.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization, Mcp-Session-Id, MCP-Protocol-Version, Accept, Last-Event-ID",
      false
    );
    response.setHeader(
      "Access-Control-Expose-Headers",
      "Mcp-Session-Id",
      false
    );
  }

  QueryInterface = ChromeUtils.generateQI(["nsIHttpRequestHandler"]);
}
