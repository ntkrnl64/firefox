/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const lazy = {};

ChromeUtils.defineESModuleGetters(lazy, {
  generateUUID: "chrome://remote/content/shared/UUID.sys.mjs",
  JSONRPC_ERRORS: "chrome://remote/content/mcp/McpDispatch.sys.mjs",
  JSONRPC_VERSION: "chrome://remote/content/mcp/McpDispatch.sys.mjs",
  Log: "chrome://remote/content/shared/Log.sys.mjs",
  McpDispatch: "chrome://remote/content/mcp/McpDispatch.sys.mjs",
  writeUtf8: "chrome://remote/content/mcp/McpDispatch.sys.mjs",
});

ChromeUtils.defineLazyGetter(lazy, "logger", () => lazy.Log.get());

/**
 * Manages an MCP session over the Streamable HTTP (SSE) transport.
 *
 * A session is created on the first `initialize` POST and identified by
 * the `Mcp-Session-Id` header on subsequent requests.
 *
 * - POST  /mcp  -> JSON-RPC request, responds with JSON or SSE stream
 * - GET   /mcp  -> Opens an SSE stream for server-initiated notifications
 * - DELETE /mcp -> Terminates the session
 */
export class McpSseConnection {
  #id;
  #eventCounter;
  #notificationStreams;

  constructor() {
    this.#id = lazy.generateUUID();
    this.#eventCounter = 0;
    this.#notificationStreams = new Set();
  }

  get id() {
    return this.#id;
  }

  close() {
    for (const stream of this.#notificationStreams) {
      try {
        stream.finish();
      } catch {
        // Already closed.
      }
    }
    this.#notificationStreams.clear();
  }

  /**
   * Handle an HTTP POST with a JSON-RPC message body.
   *
   * @param {nsIHttpRequest} request
   * @param {nsIHttpResponse} response
   */
  async handlePost(request, response, options = {}) {
    const { legacyTransport = false } = options;

    let body;
    try {
      body = this.#readRequestBody(request);
    } catch {
      this.#sendJsonError(
        response,
        null,
        lazy.JSONRPC_ERRORS.PARSE_ERROR,
        "Invalid JSON"
      );
      return;
    }

    let packet;
    try {
      packet = JSON.parse(body);
    } catch {
      this.#sendJsonError(
        response,
        null,
        lazy.JSONRPC_ERRORS.PARSE_ERROR,
        "Invalid JSON"
      );
      return;
    }

    lazy.logger.debug(`MCP SSE -> ${body}`);

    const { id, method, params } = packet;

    // Notification (no id) -> 202 Accepted
    if (id === undefined || id === null) {
      lazy.McpDispatch.handleNotification(method);
      response.setStatusLine(request.httpVersion, 202, "Accepted");
      return;
    }

    if (typeof method !== "string") {
      this.#sendJsonError(
        response,
        id,
        lazy.JSONRPC_ERRORS.INVALID_REQUEST,
        "Missing or invalid method"
      );
      return;
    }

    // Check Accept header to decide response format.
    let acceptsSse = false;
    try {
      const accept = request.getHeader("Accept");
      acceptsSse = accept.includes("text/event-stream");
    } catch {
      // No Accept header.
    }

    try {
      const result = await lazy.McpDispatch.dispatch(method, params || {});

      const jsonrpcResponse = {
        jsonrpc: lazy.JSONRPC_VERSION,
        id,
        result,
      };

      if (method === "initialize") {
        // Include session ID header on initialize response.
        response.setHeader("Mcp-Session-Id", this.#id, false);
      }

      if (legacyTransport) {
        this.#deliverViaNotificationStream(
          request,
          response,
          jsonrpcResponse
        );
      } else if (acceptsSse) {
        this.#sendSseResponse(request, response, jsonrpcResponse);
      } else {
        this.#sendJsonResponse(request, response, jsonrpcResponse);
      }
    } catch (e) {
      lazy.logger.debug(`MCP SSE error for ${method}: ${e.message}`);
      const code = e.jsonrpcCode || lazy.JSONRPC_ERRORS.INTERNAL_ERROR;
      const jsonrpcError = {
        jsonrpc: lazy.JSONRPC_VERSION,
        id,
        error: { code, message: e.message },
      };

      if (legacyTransport) {
        this.#deliverViaNotificationStream(request, response, jsonrpcError);
      } else if (acceptsSse) {
        this.#sendSseResponse(request, response, jsonrpcError);
      } else {
        this.#sendJsonResponse(request, response, jsonrpcError);
      }
    }
  }

  /**
   * Handle an HTTP GET to open an SSE stream for server-initiated events.
   *
   * @param {nsIHttpRequest} request
   * @param {nsIHttpResponse} response
   */
  handleGet(request, response) {
    response.processAsync();
    response.setStatusLine(request.httpVersion, 200, "OK");
    response.setHeader("Content-Type", "text/event-stream", false);
    response.setHeader("Cache-Control", "no-cache", false);
    response.setHeader("Connection", "keep-alive", false);
    response.setHeader("Mcp-Session-Id", this.#id, false);

    this.#notificationStreams.add(response);

    // Send the endpoint event for legacy SSE transport clients.
    // This tells the client where to POST JSON-RPC messages.
    let host, port;
    try {
      host = request.getHeader("Host") || "localhost:5195";
    } catch {
      host = "localhost:5195";
    }
    try {
      port = request.port;
    } catch {
      port = "";
    }
    // If Host header already has port, use it directly.
    const baseUrl = host.includes(":") ? `http://${host}` : `http://${host}:${port || 5195}`;
    const endpointUrl = `${baseUrl}/mcp?sessionId=${this.#id}`;
    lazy.writeUtf8(response, `event: endpoint\ndata: ${endpointUrl}\n\n`);

    lazy.logger.debug(
      `MCP SSE: Notification stream opened for session ${this.#id}, endpoint: ${endpointUrl}`
    );

    // The stream stays open until the client disconnects or session ends.
    // httpd.js will notify us via the connection closing.
  }

  /**
   * Send a server-initiated notification to all open GET streams.
   *
   * @param {object} message - JSON-RPC notification object
   */
  sendNotification(message) {
    const dead = [];
    for (const stream of this.#notificationStreams) {
      try {
        this.#writeSseEvent(stream, message);
      } catch {
        dead.push(stream);
      }
    }
    for (const s of dead) {
      this.#notificationStreams.delete(s);
    }
  }

  // -- Private helpers --

  #readRequestBody(request) {
    const inputStream = request.bodyInputStream;
    if (!inputStream) {
      return "{}";
    }
    const sis = Cc["@mozilla.org/scriptableinputstream;1"].createInstance(
      Ci.nsIScriptableInputStream
    );
    sis.init(inputStream);
    const available = sis.available();
    if (available === 0) {
      return "{}";
    }
    return sis.read(available);
  }

  #sendJsonResponse(request, response, data) {
    const json = JSON.stringify(data);
    lazy.logger.debug(`MCP SSE <- ${json}`);
    response.setStatusLine(request.httpVersion, 200, "OK");
    response.setHeader("Content-Type", "application/json", false);
    lazy.writeUtf8(response, json);
  }

  #sendJsonError(response, id, code, message) {
    const data = {
      jsonrpc: lazy.JSONRPC_VERSION,
      id,
      error: { code, message },
    };
    const json = JSON.stringify(data);
    lazy.logger.debug(`MCP SSE <- ${json}`);
    response.setStatusLine("1.1", 200, "OK");
    response.setHeader("Content-Type", "application/json", false);
    lazy.writeUtf8(response, json);
  }

  #deliverViaNotificationStream(request, response, data) {
    if (this.#notificationStreams.size === 0) {
      // No GET stream open yet; fall back to sending on the POST.
      this.#sendSseResponse(request, response, data);
      return;
    }
    this.sendNotification(data);
    response.setStatusLine(request.httpVersion, 202, "Accepted");
  }

  #sendSseResponse(request, response, data) {
    response.processAsync();
    response.setStatusLine(request.httpVersion, 200, "OK");
    response.setHeader("Content-Type", "text/event-stream", false);
    response.setHeader("Cache-Control", "no-cache", false);

    this.#writeSseEvent(response, data);

    // For request-response, close the stream after sending the result.
    try {
      response.finish();
    } catch {
      // Already finished.
    }
  }

  #writeSseEvent(response, data) {
    this.#eventCounter++;
    const eventId = `evt-${this.#eventCounter}`;
    const json = JSON.stringify(data);
    const payload = `event: message\nid: ${eventId}\ndata: ${json}\n\n`;
    lazy.logger.debug(`MCP SSE <- [${eventId}] ${json}`);
    lazy.writeUtf8(response, payload);
  }
}
