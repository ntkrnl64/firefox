/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const lazy = {};

ChromeUtils.defineESModuleGetters(lazy, {
  NetworkCapture: "chrome://remote/content/mcp/NetworkCapture.sys.mjs",
});

// Stores captured console messages.
const gConsoleMessages = [];
const MAX_CONSOLE_MESSAGES = 500;

let gConsoleListenerRegistered = false;

function getActor() {
  const win = Services.wm.getMostRecentBrowserWindow();
  if (!win?.gBrowser) {
    throw new Error("No browser window available");
  }
  const browser = win.gBrowser.selectedBrowser;
  const bc = browser?.browsingContext;
  if (!bc?.currentWindowGlobal) {
    throw new Error("No active browsing context");
  }
  return bc.currentWindowGlobal.getActor("McpContent");
}

async function evalInContent(expression) {
  const actor = getActor();
  return actor.evaluateJS(expression);
}

function getNetworkCapture() {
  // Ensure capture is running (it auto-starts with the server, but just in case).
  if (!lazy.NetworkCapture.started) {
    lazy.NetworkCapture.start();
  }
  return lazy.NetworkCapture;
}

function ensureConsoleListener() {
  if (gConsoleListenerRegistered) {
    return;
  }
  gConsoleListenerRegistered = true;

  Services.console.registerListener({
    observe(message) {
      try {
        if (message instanceof Ci.nsIScriptError) {
          let level = "error";
          if (message.flags & Ci.nsIScriptError.warningFlag) {
            level = "warn";
          } else if (message.flags & Ci.nsIScriptError.infoFlag) {
            level = "info";
          }
          gConsoleMessages.push({
            level,
            message: message.errorMessage,
            sourceName: message.sourceName,
            lineNumber: message.lineNumber,
            columnNumber: message.columnNumber,
            category: message.category,
            timestamp: message.timeStamp,
          });
        } else if (message instanceof Ci.nsIConsoleMessage) {
          gConsoleMessages.push({
            level: "log",
            message: message.message,
            timestamp: message.timeStamp,
          });
        }
      } catch {
        // Ignore errors in the listener.
      }

      if (gConsoleMessages.length > MAX_CONSOLE_MESSAGES) {
        gConsoleMessages.splice(
          0,
          gConsoleMessages.length - MAX_CONSOLE_MESSAGES
        );
      }
    },
  });
}

// Network capture is now handled by NetworkCapture.sys.mjs which auto-starts
// with the MCP server and persists across page navigations/reloads.

async function getConsoleMessages(args) {
  ensureConsoleListener();

  const { count = 50, level, clear = false } = args;
  let messages = gConsoleMessages.slice(-count);

  if (level) {
    messages = messages.filter(m => m.level === level);
  }

  if (clear) {
    gConsoleMessages.length = 0;
  }

  return [{ type: "text", text: JSON.stringify(messages, null, 2) }];
}

async function clearConsole() {
  gConsoleMessages.length = 0;
  Services.console.reset();
  return [{ type: "text", text: "Console cleared" }];
}

async function getNetworkRequests(args) {
  const cap = getNetworkCapture();

  const {
    count = 50,
    clear = false,
    domain,
    pathContains,
    method,
    statusMin,
    statusMax,
    contentTypeContains,
    includeHeaders = false,
  } = args;

  let requests = cap.requests.slice();

  if (domain) {
    requests = requests.filter(r => {
      try {
        return new URL(r.url).hostname.includes(domain);
      } catch {
        return false;
      }
    });
  }
  if (pathContains) {
    requests = requests.filter(r => r.url?.includes(pathContains));
  }
  if (method) {
    requests = requests.filter(r => r.method === method.toUpperCase());
  }
  if (statusMin !== undefined) {
    requests = requests.filter(r => r.status !== null && r.status >= statusMin);
  }
  if (statusMax !== undefined) {
    requests = requests.filter(r => r.status !== null && r.status <= statusMax);
  }
  if (contentTypeContains) {
    requests = requests.filter(r =>
      r.contentType?.includes(contentTypeContains)
    );
  }
  requests = requests.slice(-count);

  // Strip heavy fields unless requested.
  requests = requests.map(r => {
    const out = { ...r };
    if (!includeHeaders) {
      delete out.requestHeaders;
      delete out.responseHeaders;
    }
    if (!out.postData) {
      delete out.postData;
    }
    if (!out.redirectedFrom) {
      delete out.redirectedFrom;
    }
    delete out.stacktrace;
    return out;
  });

  if (clear) {
    cap.clear();
  }

  return [{ type: "text", text: JSON.stringify(requests, null, 2) }];
}

async function getRequestDetail(args) {
  const cap = getNetworkCapture();
  const { index, url } = args;
  let entry;

  if (index !== undefined) {
    entry = cap.requests[index];
  } else if (url) {
    for (let i = cap.requests.length - 1; i >= 0; i--) {
      if (cap.requests[i].url?.includes(url)) {
        entry = cap.requests[i];
        break;
      }
    }
  }

  if (!entry) {
    return [{ type: "text", text: "Request not found" }];
  }

  return [{ type: "text", text: JSON.stringify(entry, null, 2) }];
}

function findRequestEntry(cap, { index, url }) {
  if (index !== undefined) {
    return { entry: cap.requests[index], index };
  }
  if (url) {
    for (let i = cap.requests.length - 1; i >= 0; i--) {
      if (cap.requests[i].url?.includes(url)) {
        return { entry: cap.requests[i], index: i };
      }
    }
  }
  return { entry: undefined, index: -1 };
}

function formatStackFrame(frame) {
  const fn = frame.functionName || "<anonymous>";
  const loc = `${frame.filename || "?"}:${frame.lineNumber || 0}:${frame.columnNumber || 0}`;
  const async = frame.asyncCause ? ` (async: ${frame.asyncCause})` : "";
  return `  at ${fn} (${loc})${async}`;
}

async function traceRequest(args) {
  const cap = getNetworkCapture();
  const { format = "text" } = args;
  const { entry, index } = findRequestEntry(cap, args);

  if (!entry) {
    return [{ type: "text", text: "Request not found" }];
  }

  const stack = entry.stacktrace || [];

  if (format === "json") {
    return [
      {
        type: "text",
        text: JSON.stringify(
          {
            index,
            url: entry.url,
            method: entry.method,
            stacktrace: stack,
          },
          null,
          2
        ),
      },
    ];
  }

  if (!stack.length) {
    return [
      {
        type: "text",
        text: `No stack trace captured for ${entry.method} ${entry.url}\n(Request may have been initiated before MCP capture started, or by native browser code.)`,
      },
    ];
  }

  const lines = [
    `${entry.method} ${entry.url}`,
    `Initiator stack (${stack.length} frame${stack.length === 1 ? "" : "s"}):`,
    ...stack.map(formatStackFrame),
  ];
  return [{ type: "text", text: lines.join("\n") }];
}

async function getResponseBody(args) {
  const cap = getNetworkCapture();
  const { index, url } = args;

  let targetUrl;
  let entry;

  if (url) {
    targetUrl = url;
    // Also find the matching entry for headers to replay.
    for (let i = cap.requests.length - 1; i >= 0; i--) {
      if (cap.requests[i].url?.includes(url)) {
        entry = cap.requests[i];
        targetUrl = entry.url;
        break;
      }
    }
  } else if (index !== undefined) {
    entry = cap.requests[index];
    targetUrl = entry?.url;
  }

  if (!targetUrl) {
    return [{ type: "text", text: "Request not found" }];
  }

  // Re-fetch the URL to get its body.
  const result = await cap.fetchUrl(targetUrl);
  return [{ type: "text", text: result.body }];
}

async function fetchUrl(args) {
  const { url, method = "GET", headers = {} } = args;
  if (!url) {
    throw new Error("url is required");
  }

  const cap = getNetworkCapture();
  const result = await cap.fetchUrl(url, { method, headers });
  return [
    {
      type: "text",
      text: JSON.stringify(
        {
          status: result.status,
          statusText: result.statusText,
          headers: result.headers,
          bodyLength: result.body?.length || 0,
          body: result.body,
        },
        null,
        2
      ),
    },
  ];
}

async function getApiEndpoints(args) {
  const cap = getNetworkCapture();
  const { domain } = args;
  const apis = new Map();

  for (const req of cap.requests) {
    const ct = req.contentType || "";
    const isApi =
      ct.includes("json") ||
      ct.includes("xml") ||
      ct.includes("protobuf") ||
      ct.includes("grpc") ||
      req.url?.includes("/api/") ||
      req.url?.includes("/v1/") ||
      req.url?.includes("/v2/") ||
      req.url?.includes("/v3/") ||
      req.url?.includes("/graphql");

    if (!isApi) {
      continue;
    }

    if (domain) {
      try {
        if (!new URL(req.url).hostname.includes(domain)) {
          continue;
        }
      } catch {
        continue;
      }
    }

    let baseUrl;
    try {
      const u = new URL(req.url);
      baseUrl = `${u.origin}${u.pathname}`;
    } catch {
      baseUrl = req.url;
    }

    const key = `${req.method} ${baseUrl}`;
    if (!apis.has(key)) {
      apis.set(key, {
        method: req.method,
        url: baseUrl,
        contentType: ct,
        status: req.status,
        count: 0,
        exampleQueryParams: null,
        examplePostData: null,
      });
    }
    const entry = apis.get(key);
    entry.count++;
    if (!entry.exampleQueryParams) {
      try {
        const u = new URL(req.url);
        if (u.search) {
          entry.exampleQueryParams = Object.fromEntries(u.searchParams);
        }
      } catch {
        /* Ignore. */
      }
    }
    if (!entry.examplePostData && req.postData) {
      entry.examplePostData = req.postData.substring(0, 500);
    }
  }

  const sorted = Array.from(apis.values()).sort((a, b) => b.count - a.count);
  return [{ type: "text", text: JSON.stringify(sorted, null, 2) }];
}

async function getNetworkDomains() {
  const cap = getNetworkCapture();
  const domains = new Map();

  for (const req of cap.requests) {
    let hostname;
    try {
      hostname = new URL(req.url).hostname;
    } catch {
      hostname = "unknown";
    }

    if (!domains.has(hostname)) {
      domains.set(hostname, {
        domain: hostname,
        requests: 0,
        types: new Set(),
      });
    }
    const d = domains.get(hostname);
    d.requests++;
    if (req.contentType) {
      const shortType = req.contentType.split(";")[0].trim();
      d.types.add(shortType);
    }
  }

  const result = Array.from(domains.values())
    .map(d => ({
      domain: d.domain,
      requests: d.requests,
      types: Array.from(d.types),
    }))
    .sort((a, b) => b.requests - a.requests);

  return [{ type: "text", text: JSON.stringify(result, null, 2) }];
}

async function blockUrl(args) {
  const { pattern } = args;
  if (!pattern) {
    throw new Error("pattern is required");
  }
  getNetworkCapture().addBlockPattern(pattern);
  return [{ type: "text", text: `Blocking requests matching: ${pattern}` }];
}

async function unblockUrl(args) {
  const { pattern } = args;
  if (pattern) {
    getNetworkCapture().removeBlockPattern(pattern);
    return [{ type: "text", text: `Unblocked: ${pattern}` }];
  }
  getNetworkCapture().clearBlockPatterns();
  return [{ type: "text", text: "All URL blocks cleared" }];
}

async function listBlockedUrls() {
  const patterns = getNetworkCapture().blockedPatterns;
  return [
    { type: "text", text: JSON.stringify(patterns.map(String), null, 2) },
  ];
}

async function setUrlBreakpoint(args) {
  const {
    pattern,
    matchType = "substring",
    method = "ANY",
    cancelOnHit = false,
  } = args;
  if (pattern === undefined || pattern === null) {
    throw new Error("pattern is required");
  }
  if (!["substring", "wildcard", "regex"].includes(matchType)) {
    throw new Error(
      `matchType must be one of substring, wildcard, regex (got ${matchType})`
    );
  }
  const bp = getNetworkCapture().addUrlBreakpoint({
    pattern,
    matchType,
    method,
    cancelOnHit,
  });
  return [
    {
      type: "text",
      text: `Breakpoint set: [${bp.matchType}] ${bp.pattern} (method: ${bp.method}${bp.cancelOnHit ? ", cancelOnHit" : ""})`,
    },
  ];
}

async function removeUrlBreakpoint(args) {
  const { pattern } = args;
  const removed = getNetworkCapture().removeUrlBreakpoint(pattern);
  if (pattern === undefined) {
    return [{ type: "text", text: "All URL breakpoints cleared" }];
  }
  return [
    {
      type: "text",
      text: removed
        ? `Removed ${removed} breakpoint(s) matching: ${pattern}`
        : `No breakpoint found matching: ${pattern}`,
    },
  ];
}

async function listUrlBreakpoints() {
  const bps = getNetworkCapture().urlBreakpoints.map(bp => ({
    pattern: bp.pattern,
    matchType: bp.matchType,
    method: bp.method,
    cancelOnHit: bp.cancelOnHit,
    hits: bp.hits,
    lastHit: bp.lastHit,
  }));
  return [{ type: "text", text: JSON.stringify(bps, null, 2) }];
}

async function getUrlBreakpointHits(args) {
  const { count = 20, clear = false } = args;
  const cap = getNetworkCapture();
  const hits = cap.breakpointHits.slice(-count);
  if (clear) {
    cap.clearBreakpointHits();
  }
  return [{ type: "text", text: JSON.stringify(hits, null, 2) }];
}

async function getRedirectChains() {
  const cap = getNetworkCapture();
  const redirects = cap.requests.filter(r => r.redirectedFrom);
  return [
    {
      type: "text",
      text: JSON.stringify(
        redirects.map(r => ({
          from: r.redirectedFrom,
          to: r.url,
          status: r.status,
        })),
        null,
        2
      ),
    },
  ];
}

async function exportHar() {
  const cap = getNetworkCapture();
  const entries = cap.requests.map(r => ({
    startedDateTime: new Date(r.timestamp).toISOString(),
    request: {
      method: r.method,
      url: r.url,
      headers: r.requestHeaders
        ? Object.entries(r.requestHeaders).map(([name, value]) => ({
            name,
            value,
          }))
        : [],
      postData: r.postData
        ? {
            mimeType: r.requestHeaders?.["Content-Type"] || "",
            text: r.postData,
          }
        : undefined,
    },
    response: {
      status: r.status || 0,
      statusText: r.statusText || "",
      headers: r.responseHeaders
        ? Object.entries(r.responseHeaders).map(([name, value]) => ({
            name,
            value,
          }))
        : [],
      content: {
        mimeType: r.contentType || "",
        size: r.responseSize || -1,
      },
    },
  }));

  const har = {
    log: {
      version: "1.2",
      creator: { name: "firefox-mcp", version: "1.0" },
      entries,
    },
  };

  return [{ type: "text", text: JSON.stringify(har, null, 2) }];
}

async function saveHar(args) {
  const { path } = args;
  if (!path) {
    throw new Error("path is required");
  }

  const result = await exportHar();
  const data = result[0].text;
  await IOUtils.writeUTF8(path, data);
  return [{ type: "text", text: `HAR saved to ${path}` }];
}

async function getNetworkStats() {
  const cap = getNetworkCapture();
  const reqs = cap.requests;

  const byMethod = {};
  const byStatus = {};
  let totalRequests = reqs.length;
  let withResponse = 0;
  let totalPostData = 0;

  for (const r of reqs) {
    byMethod[r.method] = (byMethod[r.method] || 0) + 1;
    if (r.status !== null) {
      withResponse++;
      const bucket = `${Math.floor(r.status / 100)}xx`;
      byStatus[bucket] = (byStatus[bucket] || 0) + 1;
    }
    if (r.postData) {
      totalPostData++;
    }
  }

  return [
    {
      type: "text",
      text: JSON.stringify(
        {
          totalRequests,
          withResponse,
          withPostData: totalPostData,
          byMethod,
          byStatus,
          blocked: cap.blockedPatterns.length,
          captureRunning: cap.started,
        },
        null,
        2
      ),
    },
  ];
}

async function clearNetworkRequests() {
  getNetworkCapture().clear();
  return [{ type: "text", text: "Network log cleared" }];
}

async function getComputedStyles(args) {
  const { selector, properties } = args;
  if (!selector) {
    throw new Error("selector is required");
  }

  const propsJson = properties ? JSON.stringify(properties) : "null";
  const script = `
    (() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return JSON.stringify({ error: 'Element not found' });
      const computed = window.getComputedStyle(el);
      const props = ${propsJson};
      if (props && Array.isArray(props)) {
        const result = {};
        for (const p of props) {
          result[p] = computed.getPropertyValue(p);
        }
        return JSON.stringify(result);
      }
      const result = {};
      for (let i = 0; i < computed.length; i++) {
        const name = computed.item(i);
        result[name] = computed.getPropertyValue(name);
      }
      return JSON.stringify(result);
    })()
  `;

  const result = await evalInContent(script);
  return [{ type: "text", text: result }];
}

async function getElementBox(args) {
  const { selector } = args;
  if (!selector) {
    throw new Error("selector is required");
  }

  const script = `
    (() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return JSON.stringify({ error: 'Element not found' });
      const rect = el.getBoundingClientRect();
      const computed = window.getComputedStyle(el);
      return JSON.stringify({
        boundingRect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        margin: {
          top: computed.marginTop,
          right: computed.marginRight,
          bottom: computed.marginBottom,
          left: computed.marginLeft,
        },
        padding: {
          top: computed.paddingTop,
          right: computed.paddingRight,
          bottom: computed.paddingBottom,
          left: computed.paddingLeft,
        },
        border: {
          top: computed.borderTopWidth,
          right: computed.borderRightWidth,
          bottom: computed.borderBottomWidth,
          left: computed.borderLeftWidth,
        },
        display: computed.display,
        position: computed.position,
      });
    })()
  `;

  const result = await evalInContent(script);
  return [{ type: "text", text: result }];
}

async function getAccessibilityInfo(args) {
  const { selector } = args;
  if (!selector) {
    throw new Error("selector is required");
  }

  const script = `
    (() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return JSON.stringify({ error: 'Element not found' });
      return JSON.stringify({
        role: el.computedRole || el.getAttribute('role') || undefined,
        ariaLabel: el.ariaLabel || el.getAttribute('aria-label') || undefined,
        ariaDescribedBy: el.getAttribute('aria-describedby') || undefined,
        ariaExpanded: el.ariaExpanded || undefined,
        ariaHidden: el.ariaHidden || undefined,
        ariaDisabled: el.ariaDisabled || undefined,
        tabIndex: el.tabIndex,
        title: el.title || undefined,
        alt: el.alt || undefined,
        isVisible: el.checkVisibility?.() ?? true,
        isFocusable: el.tabIndex >= 0 || ['A','BUTTON','INPUT','SELECT','TEXTAREA'].includes(el.tagName),
      });
    })()
  `;

  const result = await evalInContent(script);
  return [{ type: "text", text: result }];
}

async function getPerformanceMetrics() {
  const script = `
    (() => {
      const perf = window.performance;
      const timing = perf.getEntriesByType('navigation')[0];
      const paint = perf.getEntriesByType('paint');
      const resources = perf.getEntriesByType('resource');
      return JSON.stringify({
        navigation: timing ? {
          domContentLoaded: timing.domContentLoadedEventEnd,
          load: timing.loadEventEnd,
          domInteractive: timing.domInteractive,
          responseEnd: timing.responseEnd,
          transferSize: timing.transferSize,
          domComplete: timing.domComplete,
        } : null,
        paint: paint.map(p => ({ name: p.name, startTime: p.startTime })),
        resourceCount: resources.length,
        memory: perf.memory ? {
          usedJSHeapSize: perf.memory.usedJSHeapSize,
          totalJSHeapSize: perf.memory.totalJSHeapSize,
        } : undefined,
      });
    })()
  `;

  const result = await evalInContent(script);
  return [{ type: "text", text: result }];
}

async function getEventListeners(args) {
  const { selector } = args;
  if (!selector) {
    throw new Error("selector is required");
  }

  const script = `
    (() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return JSON.stringify({ error: 'Element not found' });
      if (typeof InspectorUtils === 'undefined') {
        return JSON.stringify({ error: 'InspectorUtils not available' });
      }
      const listeners = InspectorUtils.getEventListenerInfo(el);
      return JSON.stringify(listeners.map(l => ({
        type: l.type,
        capturing: l.capturing,
        enabled: l.enabled,
      })));
    })()
  `;

  const result = await evalInContent(script);
  return [{ type: "text", text: result }];
}

async function getStorage(args) {
  const { storageType = "localStorage" } = args;

  const storageName =
    storageType === "sessionStorage" ? "sessionStorage" : "localStorage";
  const script = `
    (() => {
      const storage = window['${storageName}'];
      if (!storage) return JSON.stringify({ error: 'Storage not available' });
      const result = {};
      for (let i = 0; i < storage.length; i++) {
        const key = storage.key(i);
        result[key] = storage.getItem(key);
      }
      return JSON.stringify(result);
    })()
  `;

  const result = await evalInContent(script);
  return [{ type: "text", text: result }];
}

async function setStorage(args) {
  const { storageType = "localStorage", key, value } = args;
  if (!key) {
    throw new Error("key is required");
  }

  const storageName =
    storageType === "sessionStorage" ? "sessionStorage" : "localStorage";
  const removeKey = value === null || value === undefined;
  const script = removeKey
    ? `(() => {
        const storage = window['${storageName}'];
        if (!storage) return 'Storage not available';
        storage.removeItem(${JSON.stringify(key)});
        return 'Removed key: ' + ${JSON.stringify(key)};
      })()`
    : `(() => {
        const storage = window['${storageName}'];
        if (!storage) return 'Storage not available';
        storage.setItem(${JSON.stringify(key)}, ${JSON.stringify(String(value))});
        return 'Set ' + ${JSON.stringify(key)} + ' in ${storageName}';
      })()`;

  const result = await evalInContent(script);
  return [{ type: "text", text: result }];
}

export const DevToolsTools = {
  tools: [
    {
      name: "devtools_console_messages",
      description:
        "Get recent console messages (log, warn, error, info). Starts capturing on first call.",
      inputSchema: {
        type: "object",
        properties: {
          count: {
            type: "integer",
            description: "Max messages to return (default: 50)",
          },
          level: {
            type: "string",
            enum: ["log", "warn", "error", "info"],
            description: "Filter by log level",
          },
          clear: {
            type: "boolean",
            description: "Clear messages after reading",
          },
        },
      },
      handler: getConsoleMessages,
    },
    {
      name: "devtools_clear_console",
      description: "Clear all captured console messages",
      inputSchema: { type: "object", properties: {} },
      handler: clearConsole,
    },
    {
      name: "devtools_network_requests",
      description:
        "Get captured network requests with filtering. Capture is always-on and persists across page reloads.",
      inputSchema: {
        type: "object",
        properties: {
          count: {
            type: "integer",
            description: "Max requests to return (default: 50)",
          },
          domain: {
            type: "string",
            description: "Filter by domain substring (e.g. 'api.example.com')",
          },
          pathContains: {
            type: "string",
            description: "Filter by URL path substring (e.g. '/api/')",
          },
          method: {
            type: "string",
            description: "Filter by HTTP method (GET, POST, etc.)",
          },
          statusMin: {
            type: "integer",
            description: "Min status code (e.g. 400 for errors)",
          },
          statusMax: { type: "integer", description: "Max status code" },
          contentTypeContains: {
            type: "string",
            description: "Filter by content type (e.g. 'json', 'javascript')",
          },
          includeHeaders: {
            type: "boolean",
            description:
              "Include full request/response headers (default: false)",
          },
          clear: { type: "boolean", description: "Clear log after reading" },
        },
      },
      handler: getNetworkRequests,
    },
    {
      name: "devtools_request_detail",
      description:
        "Get full detail for a specific request: headers, POST data, response body, redirect info",
      inputSchema: {
        type: "object",
        properties: {
          index: { type: "integer", description: "Request index in the log" },
          url: {
            type: "string",
            description: "URL substring to match (uses most recent match)",
          },
        },
      },
      handler: getRequestDetail,
    },
    {
      name: "devtools_trace_request",
      description:
        "Get the JS initiator stack trace for a captured request (which function/method invoked it). Identify the request by index or URL substring.",
      inputSchema: {
        type: "object",
        properties: {
          index: { type: "integer", description: "Request index in the log" },
          url: {
            type: "string",
            description: "URL substring to match (uses most recent match)",
          },
          format: {
            type: "string",
            enum: ["text", "json"],
            description:
              "Output format: 'text' for a stack-style listing (default), 'json' for raw frames",
          },
        },
      },
      handler: traceRequest,
    },
    {
      name: "devtools_response_body",
      description:
        "Re-fetch a captured URL to get its response body (uses same cookies/session as browser)",
      inputSchema: {
        type: "object",
        properties: {
          index: { type: "integer", description: "Request index in the log" },
          url: {
            type: "string",
            description:
              "URL substring to match from captured traffic, or a full URL",
          },
        },
      },
      handler: getResponseBody,
    },
    {
      name: "devtools_fetch_url",
      description:
        "Fetch any URL using Firefox's HTTP stack (shares browser cookies/session). Returns status, headers, and body.",
      inputSchema: {
        type: "object",
        properties: {
          url: { type: "string", description: "URL to fetch" },
          method: { type: "string", description: "HTTP method (default: GET)" },
          headers: {
            type: "object",
            description: "Additional request headers as key-value pairs",
          },
        },
        required: ["url"],
      },
      handler: fetchUrl,
    },
    {
      name: "devtools_api_endpoints",
      description:
        "Extract and deduplicate API endpoints from traffic, with example params, POST data, and response previews",
      inputSchema: {
        type: "object",
        properties: {
          domain: { type: "string", description: "Filter by domain substring" },
        },
      },
      handler: getApiEndpoints,
    },
    {
      name: "devtools_network_domains",
      description:
        "List all domains contacted with request counts and content types",
      inputSchema: { type: "object", properties: {} },
      handler: getNetworkDomains,
    },
    {
      name: "devtools_network_stats",
      description:
        "Get network capture statistics: total requests, by method, by status code, capture state",
      inputSchema: { type: "object", properties: {} },
      handler: getNetworkStats,
    },
    {
      name: "devtools_block_url",
      description:
        "Block requests matching a URL pattern (substring match). Blocked requests get canceled.",
      inputSchema: {
        type: "object",
        properties: {
          pattern: {
            type: "string",
            description:
              "URL substring to block (e.g. 'ads.example.com', 'analytics')",
          },
        },
        required: ["pattern"],
      },
      handler: blockUrl,
    },
    {
      name: "devtools_unblock_url",
      description:
        "Remove a URL block pattern, or clear all blocks if no pattern given",
      inputSchema: {
        type: "object",
        properties: {
          pattern: {
            type: "string",
            description: "Pattern to unblock (omit to clear all)",
          },
        },
      },
      handler: unblockUrl,
    },
    {
      name: "devtools_list_blocked",
      description: "List all active URL block patterns",
      inputSchema: { type: "object", properties: {} },
      handler: listBlockedUrls,
    },
    {
      name: "devtools_set_url_breakpoint",
      description:
        "Register a URL breakpoint. When a request matches, its initiator stack is captured into devtools_url_breakpoint_hits. Supports substring, wildcard (* and ?), and regex matching. Optionally cancels the matching channel.",
      inputSchema: {
        type: "object",
        properties: {
          pattern: {
            type: "string",
            description:
              "Pattern to match against the request URL (interpretation depends on matchType)",
          },
          matchType: {
            type: "string",
            enum: ["substring", "wildcard", "regex"],
            description:
              "How to interpret the pattern. Default: substring. wildcard supports * and ? against the full URL. regex compiles via JS RegExp.",
          },
          method: {
            type: "string",
            description:
              "HTTP method to filter on (e.g. 'GET'), or 'ANY' (default)",
          },
          cancelOnHit: {
            type: "boolean",
            description:
              "If true, cancel the matching request (similar to a URL block). Default: false.",
          },
        },
        required: ["pattern"],
      },
      handler: setUrlBreakpoint,
    },
    {
      name: "devtools_remove_url_breakpoint",
      description:
        "Remove URL breakpoints by exact pattern. Omit pattern to clear all.",
      inputSchema: {
        type: "object",
        properties: {
          pattern: {
            type: "string",
            description:
              "Exact pattern that was registered (omit to clear all breakpoints)",
          },
        },
      },
      handler: removeUrlBreakpoint,
    },
    {
      name: "devtools_list_url_breakpoints",
      description:
        "List all registered URL breakpoints with their hit counts and last-hit timestamps",
      inputSchema: { type: "object", properties: {} },
      handler: listUrlBreakpoints,
    },
    {
      name: "devtools_url_breakpoint_hits",
      description:
        "Get recent URL-breakpoint hits (URL, method, matched pattern, initiator stack, timestamp)",
      inputSchema: {
        type: "object",
        properties: {
          count: {
            type: "integer",
            description: "Max hits to return (default: 20)",
          },
          clear: {
            type: "boolean",
            description: "Clear hits after reading",
          },
        },
      },
      handler: getUrlBreakpointHits,
    },
    {
      name: "devtools_redirects",
      description: "Show all redirect chains captured in the network log",
      inputSchema: { type: "object", properties: {} },
      handler: getRedirectChains,
    },
    {
      name: "devtools_export_har",
      description:
        "Export all captured network traffic as a HAR (HTTP Archive) JSON object",
      inputSchema: { type: "object", properties: {} },
      handler: exportHar,
    },
    {
      name: "devtools_save_har",
      description: "Save captured network traffic as a HAR file to disk",
      inputSchema: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "File path to save the HAR file",
          },
        },
        required: ["path"],
      },
      handler: saveHar,
    },
    {
      name: "devtools_clear_network",
      description: "Clear all captured network requests",
      inputSchema: { type: "object", properties: {} },
      handler: clearNetworkRequests,
    },
    {
      name: "devtools_computed_styles",
      description: "Get computed CSS styles for an element",
      inputSchema: {
        type: "object",
        properties: {
          selector: { type: "string", description: "CSS selector" },
          properties: {
            type: "array",
            items: { type: "string" },
            description:
              "Specific CSS properties to return. If omitted, returns all.",
          },
        },
        required: ["selector"],
      },
      handler: getComputedStyles,
    },
    {
      name: "devtools_box_model",
      description:
        "Get box model info (bounding rect, margin, padding, border) for an element",
      inputSchema: {
        type: "object",
        properties: {
          selector: { type: "string", description: "CSS selector" },
        },
        required: ["selector"],
      },
      handler: getElementBox,
    },
    {
      name: "devtools_accessibility",
      description:
        "Get accessibility info (ARIA roles, labels, focusability) for an element",
      inputSchema: {
        type: "object",
        properties: {
          selector: { type: "string", description: "CSS selector" },
        },
        required: ["selector"],
      },
      handler: getAccessibilityInfo,
    },
    {
      name: "devtools_performance",
      description:
        "Get page performance metrics (navigation timing, paint, resources)",
      inputSchema: { type: "object", properties: {} },
      handler: getPerformanceMetrics,
    },
    {
      name: "devtools_event_listeners",
      description: "Get event listeners attached to an element",
      inputSchema: {
        type: "object",
        properties: {
          selector: { type: "string", description: "CSS selector" },
        },
        required: ["selector"],
      },
      handler: getEventListeners,
    },
    {
      name: "devtools_get_storage",
      description:
        "Get all key-value pairs from localStorage or sessionStorage",
      inputSchema: {
        type: "object",
        properties: {
          storageType: {
            type: "string",
            enum: ["localStorage", "sessionStorage"],
            description: "Storage type (default: localStorage)",
          },
        },
      },
      handler: getStorage,
    },
    {
      name: "devtools_set_storage",
      description: "Set or remove a key in localStorage or sessionStorage",
      inputSchema: {
        type: "object",
        properties: {
          storageType: {
            type: "string",
            enum: ["localStorage", "sessionStorage"],
            description: "Storage type (default: localStorage)",
          },
          key: { type: "string", description: "Storage key" },
          value: {
            type: "string",
            description: "Value to set. If null/omitted, the key is removed.",
          },
        },
        required: ["key"],
      },
      handler: setStorage,
    },
  ],
};
