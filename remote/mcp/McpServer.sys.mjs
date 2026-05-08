/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const lazy = {};

ChromeUtils.defineESModuleGetters(lazy, {
  HttpServer: "chrome://remote/content/server/httpd.sys.mjs",
  Log: "chrome://remote/content/shared/Log.sys.mjs",
  McpConnectionHandler:
    "chrome://remote/content/mcp/McpConnectionHandler.sys.mjs",
  NetworkCapture: "chrome://remote/content/mcp/NetworkCapture.sys.mjs",
  PollPromise: "chrome://remote/content/shared/Sync.sys.mjs",
  registerMcpContentActor:
    "chrome://remote/content/mcp/actors/McpContentParent.sys.mjs",
  unregisterMcpContentActor:
    "chrome://remote/content/mcp/actors/McpContentParent.sys.mjs",
  writeUtf8: "chrome://remote/content/mcp/McpDispatch.sys.mjs",
});

ChromeUtils.defineLazyGetter(lazy, "logger", () => lazy.Log.get());

const DEFAULT_HOST = "localhost";

/**
 *
 */
export class McpServer {
  #connectionHandler;
  #connections;
  #host;
  #port;
  #server;

  constructor(port) {
    this.#connectionHandler = null;
    this.#connections = new Set();
    this.#host = DEFAULT_HOST;
    this.#port = port;
    this.#server = null;
  }

  get running() {
    return !!this.#server && !this.#server.isStopped();
  }

  addConnection(conn) {
    this.#connections.add(conn);
  }

  removeConnection(conn) {
    this.#connections.delete(conn);
  }

  async start() {
    if (this.running) {
      return;
    }

    // Resolve localhost to an IP address.
    let isIPv4Host = false;
    try {
      const addresses = await this.#resolveHostname(DEFAULT_HOST);
      const addressesIPv4 = addresses.filter(value => !value.includes(":"));
      isIPv4Host = !!addressesIPv4.length;
      if (isIPv4Host) {
        this.#host = addressesIPv4[0];
      } else {
        this.#host = addresses.length ? addresses[0] : DEFAULT_HOST;
      }
    } catch {
      this.#host = DEFAULT_HOST;
    }

    let port = this.#port;
    if (port === 0) {
      port = -1;
    }

    this.#server = new lazy.HttpServer();
    const host = isIPv4Host ? DEFAULT_HOST : this.#host;

    await lazy.PollPromise(
      (resolve, reject) => {
        try {
          this.#server._start(port, host);
          this.#port = this.#server._port;
          resolve();
        } catch (e) {
          lazy.logger.debug(`MCP: Could not bind to port ${port} (${e.name})`);
          reject();
        }
      },
      { interval: 250, timeout: 5000 }
    );

    if (!this.#server._socket) {
      throw new Error(`MCP: Failed to start HTTP server on port ${port}`);
    }

    if (isIPv4Host) {
      this.#server.identity.add("http", this.#host, this.#port);
    }

    // Start persistent network capture before anything else.
    lazy.NetworkCapture.start();

    // Register the JSWindowActor for content process evaluation.
    lazy.registerMcpContentActor();

    // Register the combined WebSocket + SSE handler for MCP connections.
    this.#connectionHandler = new lazy.McpConnectionHandler(this);
    this.#server.registerPathHandler("/mcp", this.#connectionHandler);

    // Register OAuth 2.0 endpoints for MCP client authentication.
    // This is a permissive local-only implementation that auto-approves
    // all clients — suitable for developer tooling, not production.
    const baseUrl = `http://${this.#host}:${this.#port}`;
    this.#server.registerPathHandler(
      "/.well-known/oauth-authorization-server",
      new OAuthMetadataHandler(baseUrl)
    );
    this.#server.registerPathHandler("/register", new OAuthRegisterHandler());
    this.#server.registerPathHandler("/authorize", new OAuthAuthorizeHandler());
    this.#server.registerPathHandler("/token", new OAuthTokenHandler());
  }

  async stop() {
    if (!this.running) {
      return;
    }

    // Close all active connections.
    for (const conn of this.#connections) {
      conn.close();
    }
    this.#connections.clear();

    try {
      // Stop network capture and close SSE sessions.
      lazy.NetworkCapture.stop();
      this.#connectionHandler?.closeAllSseSessions();
      this.#connectionHandler = null;

      lazy.unregisterMcpContentActor();
      this.#server.registerPathHandler("/mcp", null);
      this.#server.registerPathHandler(
        "/.well-known/oauth-authorization-server",
        null
      );
      this.#server.registerPathHandler("/register", null);
      this.#server.registerPathHandler("/authorize", null);
      this.#server.registerPathHandler("/token", null);
      await this.#server.stop();
    } catch (e) {
      lazy.logger.error(`MCP: Failed to stop server: ${e.message}`, e);
    } finally {
      this.#server = null;
    }
  }

  #resolveHostname(hostname) {
    return new Promise((resolve, reject) => {
      let originalRequest;

      const listener = {
        onLookupComplete(request, record, status) {
          if (request !== originalRequest) {
            return;
          }
          if (!Components.isSuccessCode(status)) {
            reject({ message: ChromeUtils.getXPCOMErrorName(status) });
            return;
          }

          record.QueryInterface(Ci.nsIDNSAddrRecord);
          const addresses = [];
          while (record.hasMore()) {
            let addr = record.getNextAddrAsString();
            if (addr.includes(":") && !addr.startsWith("[")) {
              addr = `[${addr}]`;
            }
            if (!addresses.includes(addr)) {
              addresses.push(addr);
            }
          }
          resolve(addresses);
        },
      };

      try {
        originalRequest = Services.dns.asyncResolve(
          hostname,
          Ci.nsIDNSService.RESOLVE_TYPE_DEFAULT,
          Ci.nsIDNSService.RESOLVE_BYPASS_CACHE,
          null,
          listener,
          null,
          {}
        );
      } catch (e) {
        reject({ message: e.message });
      }
    });
  }
}

// ---- OAuth 2.0 handlers (local dev, auto-approve) ----

function jsonResponse(response, status, body) {
  response.setStatusLine("1.1", status, status === 200 ? "OK" : "Error");
  response.setHeader("Content-Type", "application/json", false);
  response.setHeader("Access-Control-Allow-Origin", "*", false);
  response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS", false);
  response.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization",
    false
  );
  response.setHeader("Cache-Control", "no-store", false);
  const json = JSON.stringify(body);
  lazy.writeUtf8(response, json);
}

class OAuthMetadataHandler {
  #baseUrl;
  constructor(baseUrl) {
    this.#baseUrl = baseUrl;
  }
  handle(request, response) {
    if (request.method === "OPTIONS") {
      response.setStatusLine("1.1", 204, "No Content");
      response.setHeader("Access-Control-Allow-Origin", "*", false);
      response.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS", false);
      return;
    }
    jsonResponse(response, 200, {
      issuer: this.#baseUrl,
      authorization_endpoint: `${this.#baseUrl}/authorize`,
      token_endpoint: `${this.#baseUrl}/token`,
      registration_endpoint: `${this.#baseUrl}/register`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
    });
  }
}

class OAuthRegisterHandler {
  handle(request, response) {
    if (request.method === "OPTIONS") {
      response.setStatusLine("1.1", 204, "No Content");
      response.setHeader("Access-Control-Allow-Origin", "*", false);
      response.setHeader(
        "Access-Control-Allow-Methods",
        "POST, OPTIONS",
        false
      );
      response.setHeader(
        "Access-Control-Allow-Headers",
        "Content-Type",
        false
      );
      return;
    }
    // Auto-register any client
    let body = {};
    try {
      const inputStream = Cc[
        "@mozilla.org/scriptableinputstream;1"
      ].createInstance(Ci.nsIScriptableInputStream);
      inputStream.init(request.bodyInputStream);
      const raw = inputStream.read(inputStream.available());
      body = JSON.parse(raw);
    } catch {
      // Ignore
    }
    const clientId = "mcp-local-" + Date.now();
    jsonResponse(response, 200, {
      client_id: clientId,
      client_name: body.client_name || "MCP Client",
      redirect_uris: body.redirect_uris || [],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    });
  }
}

class OAuthAuthorizeHandler {
  handle(request, response) {
    if (request.method === "OPTIONS") {
      response.setStatusLine("1.1", 204, "No Content");
      response.setHeader("Access-Control-Allow-Origin", "*", false);
      return;
    }
    // Extract redirect_uri and state from query string, auto-approve
    const qs = request.queryString || "";
    const params = new URLSearchParams(qs);
    const redirectUri = params.get("redirect_uri") || "";
    const state = params.get("state") || "";
    const code = "mcp-auth-code-" + Date.now();

    if (redirectUri) {
      const sep = redirectUri.includes("?") ? "&" : "?";
      const location = `${redirectUri}${sep}code=${code}&state=${encodeURIComponent(state)}`;
      response.setStatusLine("1.1", 302, "Found");
      response.setHeader("Location", location, false);
    } else {
      jsonResponse(response, 200, { code, state });
    }
  }
}

class OAuthTokenHandler {
  handle(request, response) {
    if (request.method === "OPTIONS") {
      response.setStatusLine("1.1", 204, "No Content");
      response.setHeader("Access-Control-Allow-Origin", "*", false);
      response.setHeader(
        "Access-Control-Allow-Methods",
        "POST, OPTIONS",
        false
      );
      response.setHeader(
        "Access-Control-Allow-Headers",
        "Content-Type, Authorization",
        false
      );
      return;
    }
    // Issue a token for any request
    jsonResponse(response, 200, {
      access_token: "mcp-local-token-" + Date.now(),
      token_type: "Bearer",
      expires_in: 86400,
      refresh_token: "mcp-local-refresh-" + Date.now(),
    });
  }
}
