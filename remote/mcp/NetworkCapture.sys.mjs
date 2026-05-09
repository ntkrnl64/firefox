/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const lazy = {};

ChromeUtils.defineESModuleGetters(lazy, {
  Log: "chrome://remote/content/shared/Log.sys.mjs",
});

ChromeUtils.defineLazyGetter(lazy, "logger", () => lazy.Log.get());

const MAX_BODY_SIZE = 1024 * 1024;
const MAX_REQUESTS = 1000;
const MAX_WS_MESSAGES = 500;
const MAX_BREAKPOINT_HITS = 200;

// Captured data stores.
const gRequests = [];
const gChannelMap = new Map();
const gPendingStacks = new Map();
const gWebSocketMessages = [];
const gBlockedPatterns = [];
const gUrlBreakpoints = [];
const gBreakpointHits = [];

const MAX_STACK_FRAMES = 50;

let gStarted = false;
let gOpeningObserver = null;
let gAlternateStackObserver = null;
let gRequestObserver = null;
let gResponseObserver = null;
let gCachedResponseObserver = null;
let gMergedResponseObserver = null;

function collectHeaders(channel, isRequest) {
  const headers = {};
  try {
    const visitor = {
      visitHeader(name, value) {
        headers[name] = value;
      },
      QueryInterface: ChromeUtils.generateQI(["nsIHttpHeaderVisitor"]),
    };
    if (isRequest) {
      channel.visitRequestHeaders(visitor);
    } else {
      channel.visitResponseHeaders(visitor);
    }
  } catch {
    // Ignore.
  }
  return headers;
}

function readPostData(channel) {
  try {
    const uploadChannel = channel.QueryInterface(Ci.nsIUploadChannel);
    const stream = uploadChannel.uploadStream;
    if (!stream) {
      return null;
    }

    // Clone the stream so we don't consume it.
    const seekable = stream.QueryInterface(Ci.nsISeekableStream);
    const originalPos = seekable.tell();
    seekable.seek(Ci.nsISeekableStream.NS_SEEK_SET, 0);

    const sis = Cc["@mozilla.org/scriptableinputstream;1"].createInstance(
      Ci.nsIScriptableInputStream
    );
    sis.init(stream);
    const available = Math.min(sis.available(), MAX_BODY_SIZE);
    let data = "";
    if (available > 0) {
      data = sis.read(available);
    }

    // Restore stream position so the request isn't broken.
    seekable.seek(Ci.nsISeekableStream.NS_SEEK_SET, originalPos);

    // Strip MIME headers prepended by the upload stream if present.
    const headerEnd = data.indexOf("\r\n\r\n");
    if (headerEnd >= 0 && headerEnd < 256) {
      return data.substring(headerEnd + 4);
    }
    return data;
  } catch {
    return null;
  }
}

function shouldBlock(url) {
  for (const pattern of gBlockedPatterns) {
    if (typeof pattern === "string") {
      if (url.includes(pattern)) {
        return true;
      }
    } else if (pattern instanceof RegExp) {
      if (pattern.test(url)) {
        return true;
      }
    }
  }
  return false;
}

function pruneRequests() {
  if (gRequests.length > MAX_REQUESTS) {
    const removed = gRequests.length - MAX_REQUESTS;
    gRequests.splice(0, removed);
    for (const [key, val] of gChannelMap) {
      if (val < removed) {
        gChannelMap.delete(key);
      } else {
        gChannelMap.set(key, val - removed);
      }
    }
  }
}

// Response body capture via nsITraceableChannel was removed because it
// interferes with Firefox internal requests (update checks, settings sync,
// CDN fetches). Instead, use devtools_fetch_url to re-fetch a URL on demand.

function captureCurrentStack() {
  const frames = [];
  let frame = Components.stack;
  // Skip our own frames (captureCurrentStack + observe).
  if (frame?.caller) {
    frame = frame.caller;
  }
  if (frame?.caller) {
    frame = frame.caller;
  }
  while (frame && frames.length < MAX_STACK_FRAMES) {
    frames.push({
      filename: frame.filename,
      lineNumber: frame.lineNumber,
      columnNumber: frame.columnNumber,
      functionName: frame.name,
      asyncCause: frame.asyncCause,
    });
    frame = frame.caller || frame.asyncCaller;
  }
  return frames;
}

function parseAlternateStack(data) {
  const frames = [];
  let frame;
  try {
    frame = JSON.parse(data);
  } catch {
    return frames;
  }
  while (frame && frames.length < MAX_STACK_FRAMES) {
    frames.push({
      filename: frame.source,
      lineNumber: frame.line,
      columnNumber: frame.column,
      functionName: frame.functionDisplayName,
      asyncCause: frame.asyncCause,
    });
    frame = frame.parent || frame.asyncParent;
  }
  return frames;
}

function getChannelId(subject) {
  try {
    return subject.QueryInterface(Ci.nsIHttpChannel).channelId;
  } catch {
    // Ignore.
  }
  try {
    return subject.QueryInterface(Ci.nsIIdentChannel).channelId;
  } catch {
    // Ignore.
  }
  return null;
}

function _wildcardToRegExp(glob) {
  let out = "";
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i];
    if (ch === "*") {
      out += ".*";
    } else if (ch === "?") {
      out += ".";
    } else if (/[.+^${}()|[\]\\]/.test(ch)) {
      out += "\\" + ch;
    } else {
      out += ch;
    }
  }
  return new RegExp("^" + out + "$");
}

function compileBreakpoint(bp) {
  if (bp._matcherKey === bp.pattern && bp._matcherType === bp.matchType) {
    return bp._matcher;
  }
  bp._matcherKey = bp.pattern;
  bp._matcherType = bp.matchType;
  bp._matcher = null;
  try {
    if (bp.matchType === "regex") {
      bp._matcher = new RegExp(bp.pattern);
    } else if (bp.matchType === "wildcard") {
      bp._matcher = _wildcardToRegExp(bp.pattern);
    }
  } catch (e) {
    bp._compileError = e.message;
  }
  return bp._matcher;
}

function urlMatchesBreakpoint(url, bp) {
  if (!bp.pattern) {
    return true;
  }
  const re = compileBreakpoint(bp);
  if (re) {
    return re.test(url);
  }
  return url.includes(bp.pattern);
}

function checkUrlBreakpoints(channel, url, stack) {
  if (!gUrlBreakpoints.length || !url) {
    return;
  }
  let method;
  try {
    method = channel.requestMethod;
  } catch {
    method = "";
  }
  for (const bp of gUrlBreakpoints) {
    if (bp.method && bp.method !== "ANY" && bp.method !== method) {
      continue;
    }
    if (!urlMatchesBreakpoint(url, bp)) {
      continue;
    }
    bp.hits = (bp.hits || 0) + 1;
    bp.lastHit = Date.now();
    gBreakpointHits.push({
      pattern: bp.pattern,
      matchType: bp.matchType,
      url,
      method,
      timestamp: bp.lastHit,
      stacktrace: stack,
    });
    if (gBreakpointHits.length > MAX_BREAKPOINT_HITS) {
      gBreakpointHits.splice(
        0,
        gBreakpointHits.length - MAX_BREAKPOINT_HITS
      );
    }
    if (bp.cancelOnHit) {
      try {
        channel.cancel(Cr.NS_ERROR_ABORT);
      } catch {
        // Already past the cancellable window.
      }
    }
    lazy.logger.info(
      `MCP URL breakpoint hit: ${bp.matchType}:${bp.pattern} -> ${method} ${url}`
    );
    // First match wins; further patterns are not evaluated for this channel.
    return;
  }
}

function onOpening(subject) {
  const id = getChannelId(subject);
  if (id === null) {
    return;
  }
  let stack = null;
  if (!gPendingStacks.has(id)) {
    // First stack wins (mirrors DevTools' NetworkEventStackTracesWatcher).
    stack = captureCurrentStack();
    if (stack.length) {
      gPendingStacks.set(id, stack);
    }
  } else {
    stack = gPendingStacks.get(id);
  }
  let url;
  try {
    url = subject.QueryInterface(Ci.nsIHttpChannel).URI?.spec;
  } catch {
    return;
  }
  checkUrlBreakpoints(subject, url, stack || []);
}

function onAlternateStack(subject, _topic, data) {
  const id = getChannelId(subject);
  if (id === null) {
    return;
  }
  if (gPendingStacks.has(id)) {
    return;
  }
  const stack = parseAlternateStack(data);
  if (stack.length) {
    gPendingStacks.set(id, stack);
  }
}

function takePendingStack(channel) {
  try {
    const id = channel.QueryInterface(Ci.nsIIdentChannel).channelId;
    if (gPendingStacks.has(id)) {
      const s = gPendingStacks.get(id);
      gPendingStacks.delete(id);
      return s;
    }
  } catch {
    // Ignore.
  }
  return null;
}

function onRequest(subject) {
  try {
    const channel = subject.QueryInterface(Ci.nsIHttpChannel);
    const url = channel.URI?.spec;

    // Block matching URLs.
    if (url && shouldBlock(url)) {
      channel.cancel(Cr.NS_ERROR_ABORT);
      return;
    }

    // Track redirects.
    let redirectedFrom = null;
    try {
      const loadInfo = channel.loadInfo;
      if (loadInfo?.redirectChain?.length) {
        const last = loadInfo.redirectChain[loadInfo.redirectChain.length - 1];
        redirectedFrom = last.principal?.URI?.spec || null;
      }
    } catch {
      // Ignore.
    }

    const postData = readPostData(channel);
    const stacktrace = takePendingStack(channel);

    const entry = {
      url,
      method: channel.requestMethod,
      status: null,
      statusText: null,
      contentType: null,
      requestHeaders: collectHeaders(channel, true),
      responseHeaders: null,
      postData,
      redirectedFrom,
      stacktrace,
      timestamp: Date.now(),
    };
    const idx = gRequests.push(entry) - 1;

    try {
      const identChannel = channel.QueryInterface(Ci.nsIIdentChannel);
      gChannelMap.set(identChannel.channelId, idx);
    } catch {
      // Fallback.
    }

    pruneRequests();
  } catch {
    // Ignore.
  }
}

function onResponse(subject) {
  try {
    const channel = subject.QueryInterface(Ci.nsIHttpChannel);
    let idx = -1;

    try {
      const identChannel = channel.QueryInterface(Ci.nsIIdentChannel);
      const chanId = identChannel.channelId;
      if (gChannelMap.has(chanId)) {
        idx = gChannelMap.get(chanId);
        gChannelMap.delete(chanId);
      }
    } catch {
      // Fallback.
    }

    if (idx < 0) {
      const url = channel.URI?.spec;
      for (let i = gRequests.length - 1; i >= 0; i--) {
        if (gRequests[i].url === url && gRequests[i].status === null) {
          idx = i;
          break;
        }
      }
    }

    if (idx >= 0 && idx < gRequests.length) {
      gRequests[idx].status = channel.responseStatus;
      gRequests[idx].statusText = channel.responseStatusText;
      gRequests[idx].responseHeaders = collectHeaders(channel, false);
      try {
        gRequests[idx].contentType = channel.getResponseHeader("Content-Type");
      } catch {
        // No header.
      }

      // Response body size from Content-Length header if available.
      try {
        const cl = channel.getResponseHeader("Content-Length");
        if (cl) {
          gRequests[idx].responseSize = parseInt(cl, 10);
        }
      } catch {
        // No Content-Length header.
      }
    }
  } catch {
    // Ignore.
  }
}

export const NetworkCapture = {
  get requests() {
    return gRequests;
  },

  get webSocketMessages() {
    return gWebSocketMessages;
  },

  get blockedPatterns() {
    return gBlockedPatterns;
  },

  get urlBreakpoints() {
    return gUrlBreakpoints;
  },

  get breakpointHits() {
    return gBreakpointHits;
  },

  get started() {
    return gStarted;
  },

  start() {
    if (gStarted) {
      return;
    }
    gStarted = true;

    gOpeningObserver = { observe: onOpening };
    gAlternateStackObserver = { observe: onAlternateStack };
    gRequestObserver = { observe: onRequest };
    gResponseObserver = { observe: onResponse };
    gCachedResponseObserver = { observe: onResponse };
    gMergedResponseObserver = { observe: onResponse };

    Services.obs.addObserver(gOpeningObserver, "http-on-opening-request");
    Services.obs.addObserver(gOpeningObserver, "document-on-opening-request");
    Services.obs.addObserver(
      gAlternateStackObserver,
      "network-monitor-alternate-stack"
    );
    Services.obs.addObserver(gRequestObserver, "http-on-modify-request");
    Services.obs.addObserver(gResponseObserver, "http-on-examine-response");
    Services.obs.addObserver(
      gCachedResponseObserver,
      "http-on-examine-cached-response"
    );
    Services.obs.addObserver(
      gMergedResponseObserver,
      "http-on-examine-merged-response"
    );

    // WebSocket observer.
    try {
      Services.obs.addObserver(
        {
          observe(subject, topic) {
            try {
              if (gWebSocketMessages.length >= MAX_WS_MESSAGES) {
                gWebSocketMessages.splice(
                  0,
                  gWebSocketMessages.length - MAX_WS_MESSAGES + 1
                );
              }
              const channel = subject.QueryInterface(Ci.nsIHttpChannel);
              gWebSocketMessages.push({
                url: channel.URI?.spec,
                topic,
                timestamp: Date.now(),
              });
            } catch {
              // Ignore.
            }
          },
        },
        "websocket-event"
      );
    } catch {
      // websocket-event may not be available in all builds.
    }

    lazy.logger.info("MCP: Network capture started");
  },

  stop() {
    if (!gStarted) {
      return;
    }

    try {
      Services.obs.removeObserver(gOpeningObserver, "http-on-opening-request");
      Services.obs.removeObserver(
        gOpeningObserver,
        "document-on-opening-request"
      );
      Services.obs.removeObserver(
        gAlternateStackObserver,
        "network-monitor-alternate-stack"
      );
      Services.obs.removeObserver(gRequestObserver, "http-on-modify-request");
      Services.obs.removeObserver(
        gResponseObserver,
        "http-on-examine-response"
      );
      Services.obs.removeObserver(
        gCachedResponseObserver,
        "http-on-examine-cached-response"
      );
      Services.obs.removeObserver(
        gMergedResponseObserver,
        "http-on-examine-merged-response"
      );
    } catch {
      // Ignore.
    }
    gPendingStacks.clear();

    gStarted = false;
    lazy.logger.info("MCP: Network capture stopped");
  },

  clear() {
    gRequests.length = 0;
    gChannelMap.clear();
    gPendingStacks.clear();
    gWebSocketMessages.length = 0;
    gBreakpointHits.length = 0;
  },

  addBlockPattern(pattern) {
    gBlockedPatterns.push(pattern);
  },

  removeBlockPattern(pattern) {
    const idx = gBlockedPatterns.indexOf(pattern);
    if (idx >= 0) {
      gBlockedPatterns.splice(idx, 1);
    }
  },

  clearBlockPatterns() {
    gBlockedPatterns.length = 0;
  },

  /**
   * Register a URL breakpoint. The next request whose URL matches the
   * pattern will be recorded together with its initiator stack and made
   * available via breakpointHits. Optionally the channel is cancelled.
   *
   * @param {object} options
   * @param {string} options.pattern
   * @param {"substring"|"wildcard"|"regex"} [options.matchType]
   * @param {string} [options.method] HTTP method, "ANY" for any (default).
   * @param {boolean} [options.cancelOnHit]
   * @returns {object} The registered breakpoint entry.
   */
  addUrlBreakpoint({
    pattern,
    matchType = "substring",
    method = "ANY",
    cancelOnHit = false,
  }) {
    const bp = {
      pattern: pattern || "",
      matchType,
      method,
      cancelOnHit: !!cancelOnHit,
      hits: 0,
      lastHit: null,
    };
    // Validate pattern compiles cleanly when applicable.
    compileBreakpoint(bp);
    if (bp._compileError) {
      throw new Error(`Invalid ${matchType} pattern: ${bp._compileError}`);
    }
    gUrlBreakpoints.push(bp);
    return bp;
  },

  removeUrlBreakpoint(pattern) {
    if (pattern === undefined) {
      gUrlBreakpoints.length = 0;
      return 0;
    }
    let removed = 0;
    for (let i = gUrlBreakpoints.length - 1; i >= 0; i--) {
      if (gUrlBreakpoints[i].pattern === pattern) {
        gUrlBreakpoints.splice(i, 1);
        removed++;
      }
    }
    return removed;
  },

  clearBreakpointHits() {
    gBreakpointHits.length = 0;
  },

  /**
   * Re-fetch a URL to get its response body. This is safe since it doesn't
   * intercept any existing streams. Uses the same cookies/session as the
   * browser for authenticated endpoints.
   *
   * @param {string} url
   * @param {object} options
   * @param {string} options.method - HTTP method (default: GET)
   * @param {object} options.headers - Additional headers
   * @returns {Promise<{status, headers, body}>}
   */
  async fetchUrl(url, options = {}) {
    const { method = "GET", headers = {} } = options;

    return new Promise((resolve, reject) => {
      try {
        const xhr = new XMLHttpRequest();
        xhr.mozBackgroundRequest = true;
        xhr.open(method, url, true);
        xhr.responseType = "text";

        for (const [name, value] of Object.entries(headers)) {
          xhr.setRequestHeader(name, value);
        }

        xhr.onload = () => {
          const respHeaders = {};
          const rawHeaders = xhr.getAllResponseHeaders();
          for (const line of rawHeaders.split("\r\n")) {
            const idx = line.indexOf(": ");
            if (idx > 0) {
              respHeaders[line.substring(0, idx)] = line.substring(idx + 2);
            }
          }
          resolve({
            status: xhr.status,
            statusText: xhr.statusText,
            headers: respHeaders,
            body: xhr.responseText,
          });
        };

        xhr.onerror = () => reject(new Error(`Fetch failed: ${url}`));
        xhr.ontimeout = () => reject(new Error(`Fetch timed out: ${url}`));
        xhr.timeout = 30000;
        xhr.send();
      } catch (e) {
        reject(e);
      }
    });
  },
};
