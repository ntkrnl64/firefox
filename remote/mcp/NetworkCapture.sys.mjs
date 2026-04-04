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

// Captured data stores.
const gRequests = [];
const gChannelMap = new Map();
const gWebSocketMessages = [];
const gBlockedPatterns = [];

let gStarted = false;
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

  get started() {
    return gStarted;
  },

  start() {
    if (gStarted) {
      return;
    }
    gStarted = true;

    gRequestObserver = { observe: onRequest };
    gResponseObserver = { observe: onResponse };
    gCachedResponseObserver = { observe: onResponse };
    gMergedResponseObserver = { observe: onResponse };

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

    gStarted = false;
    lazy.logger.info("MCP: Network capture stopped");
  },

  clear() {
    gRequests.length = 0;
    gChannelMap.clear();
    gWebSocketMessages.length = 0;
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
