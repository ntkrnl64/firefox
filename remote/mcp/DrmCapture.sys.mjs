/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// DISCLAIMER: This file is part of an unofficial Firefox modification that
// adds DRM/EME debugging tools for the MCP server. Do NOT use to circumvent
// digital rights management.

// Parent-process registry for DRM breakpoints, hits, and entry-point triggers.
// Mirrors the design of NetworkCapture. EME does not have observer
// notifications equivalent to nsIObserverService for HTTP, so the actual
// matching wrappers have to be installed in content (the page) — see
// DRM_CONTENT_INSTALLER below.

const lazy = {};

ChromeUtils.defineESModuleGetters(lazy, {
  Log: "chrome://remote/content/shared/Log.sys.mjs",
});

ChromeUtils.defineLazyGetter(lazy, "logger", () => lazy.Log.get());

const MAX_HITS = 200;
const MAX_TRIGGERS = 500;

const DRM_TRIGGER_METHODS = [
  "requestMediaKeySystemAccess",
  "createMediaKeys",
  "setMediaKeys",
  "createSession",
  "generateRequest",
  "setServerCertificate",
  "getStatusForPolicy",
  "update",
  "close",
  "remove",
];

const gBreakpoints = [];
const gHits = [];
const gTriggers = [];

let gStarted = false;
let gIdCounter = 0;

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
  if (
    bp._matcherKey === bp.pattern &&
    bp._matcherType === bp.matchType
  ) {
    return bp._matcher;
  }
  bp._matcherKey = bp.pattern;
  bp._matcherType = bp.matchType;
  bp._matcher = null;
  bp._compileError = null;
  if (!bp.pattern) {
    return null;
  }
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

function serializeBreakpoint(bp) {
  return {
    id: bp.id,
    method: bp.method || "ANY",
    keySystem: bp.keySystem || null,
    initDataType: bp.initDataType || null,
    pattern: bp.pattern || null,
    matchType: bp.matchType || "substring",
    cancelOnHit: !!bp.cancelOnHit,
    pauseOnHit: !!bp.pauseOnHit,
    enabled: bp.enabled !== false,
    hits: bp.hits || 0,
    lastHit: bp.lastHit || null,
    compileError: bp._compileError || null,
  };
}

function pruneHits() {
  if (gHits.length > MAX_HITS) {
    gHits.splice(0, gHits.length - MAX_HITS);
  }
}

function pruneTriggers() {
  if (gTriggers.length > MAX_TRIGGERS) {
    gTriggers.splice(0, gTriggers.length - MAX_TRIGGERS);
  }
}

// The content-side installer. Stringified so it can be eval'd inside the
// page via DevToolsTools.evalInContent. Wraps EME APIs, holds a local copy
// of the active breakpoints (refreshed by setBreakpoints), and exposes
// drainHits/drainTriggers for the parent to poll.
//
// The wrappers store hits/triggers on a window-local global rather than
// trying to message the parent process directly, because evalInContent runs
// in the page's compartment.
const DRM_CONTENT_INSTALLER = `
(function () {
  const root = window.__mcpDrmCapture__ = window.__mcpDrmCapture__ || {
    installed: false,
    breakpoints: [],
    hits: [],
    triggers: [],
    maxHits: ${MAX_HITS},
    maxTriggers: ${MAX_TRIGGERS},
  };
  if (root.installed) {
    return "already-installed";
  }
  root.installed = true;

  function wildcardToRegExp(glob) {
    let out = "";
    for (let i = 0; i < glob.length; i++) {
      const ch = glob[i];
      if (ch === "*") out += ".*";
      else if (ch === "?") out += ".";
      else if (/[.+^\\\${}()|[\\]\\\\]/.test(ch)) out += "\\\\" + ch;
      else out += ch;
    }
    return new RegExp("^" + out + "$");
  }
  function compile(bp) {
    if (bp._key === bp.pattern && bp._type === bp.matchType) return bp._re;
    bp._key = bp.pattern; bp._type = bp.matchType; bp._re = null;
    if (!bp.pattern) return null;
    try {
      if (bp.matchType === "regex") bp._re = new RegExp(bp.pattern);
      else if (bp.matchType === "wildcard") bp._re = wildcardToRegExp(bp.pattern);
    } catch {}
    return bp._re;
  }
  function matches(bp, method, ctx) {
    if (bp.enabled === false) return false;
    if (bp.method && bp.method !== "ANY" && bp.method !== method) return false;
    if (bp.keySystem && !((ctx.keySystem || "").includes(bp.keySystem))) return false;
    if (bp.initDataType && bp.initDataType !== ctx.initDataType) return false;
    if (bp.pattern) {
      const re = compile(bp);
      const target = ctx.matchTarget || "";
      if (re) { if (!re.test(target)) return false; }
      else if (!target.includes(bp.pattern)) return false;
    }
    return true;
  }
  function captureStack() {
    try {
      const lines = (new Error()).stack.split("\\n");
      return lines.slice(2).join("\\n") || null;
    } catch { return null; }
  }
  function bytesToHex(buf) {
    try {
      return Array.from(new Uint8Array(buf))
        .map(b => b.toString(16).padStart(2, "0")).join("");
    } catch { return ""; }
  }
  const TRIGGER_METHODS = ${JSON.stringify(DRM_TRIGGER_METHODS)};
  function recordTrigger(method, ctx, stack) {
    if (!TRIGGER_METHODS.includes(method)) return;
    root.triggers.push({
      timestamp: Date.now(), method,
      keySystem: ctx.keySystem || "",
      sessionId: ctx.sessionId || null,
      initDataType: ctx.initDataType || null,
      initDataHex: ctx.initDataHex || null,
      detail: ctx.detail || "",
      stack: stack || null,
    });
    if (root.triggers.length > root.maxTriggers) {
      root.triggers.splice(0, root.triggers.length - root.maxTriggers);
    }
  }
  function checkBp(method, ctx, stack) {
    let matched = null;
    for (const bp of root.breakpoints) {
      if (matches(bp, method, ctx)) { matched = bp; break; }
    }
    if (!matched) return null;
    matched.hits = (matched.hits || 0) + 1;
    matched.lastHit = Date.now();
    root.hits.push({
      bpId: matched.id, method, timestamp: matched.lastHit,
      keySystem: ctx.keySystem || "",
      sessionId: ctx.sessionId || null,
      initDataType: ctx.initDataType || null,
      initDataHex: ctx.initDataHex || null,
      detail: ctx.detail || "",
      pattern: matched.pattern || null,
      matchType: matched.matchType || "substring",
      cancelOnHit: !!matched.cancelOnHit,
      pauseOnHit: !!matched.pauseOnHit,
      stack: stack || null,
    });
    if (root.hits.length > root.maxHits) {
      root.hits.splice(0, root.hits.length - root.maxHits);
    }
    if (matched.pauseOnHit) {
      try { debugger; } catch {}
    }
    return matched;
  }
  function emit(method, ctx, stack) {
    recordTrigger(method, ctx, stack);
    return checkBp(method, ctx, stack);
  }
  function maybeCancel(method, hit) {
    if (hit?.cancelOnHit) {
      throw new DOMException(
        "DRM breakpoint canceled (" + method + "): " + hit.bpId,
        "OperationError"
      );
    }
  }

  // requestMediaKeySystemAccess
  if (navigator.requestMediaKeySystemAccess && !navigator.requestMediaKeySystemAccess.__mcpDrmWrapped) {
    const orig = navigator.requestMediaKeySystemAccess.bind(navigator);
    const wrapped = function (keySystem, configs) {
      const stack = captureStack();
      const hit = emit("requestMediaKeySystemAccess", {
        keySystem, matchTarget: keySystem,
        detail: "keySystem: " + keySystem,
      }, stack);
      maybeCancel("requestMediaKeySystemAccess", hit);
      return orig(keySystem, configs);
    };
    wrapped.__mcpDrmWrapped = true;
    navigator.requestMediaKeySystemAccess = wrapped;
  }

  function wrapProto(Ctor, name, extract) {
    if (!Ctor || !Ctor.prototype || !Ctor.prototype[name]) return;
    if (Ctor.prototype[name].__mcpDrmWrapped) return;
    const orig = Ctor.prototype[name];
    const wrapped = function (...args) {
      const stack = captureStack();
      const ctx = extract ? extract.call(this, args) : { matchTarget: "" };
      const hit = emit(name, ctx, stack);
      maybeCancel(name, hit);
      return orig.apply(this, args);
    };
    wrapped.__mcpDrmWrapped = true;
    Ctor.prototype[name] = wrapped;
  }

  wrapProto(window.MediaKeySystemAccess, "createMediaKeys", function () {
    const ks = this.keySystem || "";
    return { keySystem: ks, matchTarget: ks, detail: "keySystem: " + ks };
  });
  wrapProto(window.HTMLMediaElement, "setMediaKeys", function (args) {
    const mk = args[0];
    const ks = mk?.keySystem || "(null)";
    const src = this.currentSrc || this.src || "";
    return { keySystem: ks, matchTarget: ks + " " + src,
             detail: "<" + this.tagName.toLowerCase() + "> keySystem: " + ks };
  });
  wrapProto(window.MediaKeys, "createSession", function (args) {
    const ks = this.keySystem || "";
    const st = args[0] || "temporary";
    return { keySystem: ks, matchTarget: ks + " " + st,
             detail: "Type: " + st + ", keySystem: " + ks };
  });
  wrapProto(window.MediaKeys, "setServerCertificate", function (args) {
    const ks = this.keySystem || "";
    const cert = args[0];
    const hex = cert ? bytesToHex(cert) : "";
    return { keySystem: ks, matchTarget: hex,
             detail: "Certificate: " + (cert?.byteLength || 0) + " bytes" };
  });
  wrapProto(window.MediaKeys, "getStatusForPolicy", function (args) {
    const ks = this.keySystem || "";
    const v = args[0]?.minHdcpVersion || "(none)";
    return { keySystem: ks, matchTarget: String(v),
             detail: "minHdcpVersion: " + v };
  });
  wrapProto(window.MediaKeySession, "generateRequest", function (args) {
    const dt = args[0]; const data = args[1];
    const hex = data ? bytesToHex(data) : "";
    return {
      sessionId: this.sessionId || "",
      initDataType: dt, initDataHex: hex,
      matchTarget: (dt || "") + " " + hex + " " + (this.sessionId || ""),
      detail: "initDataType: " + dt + ", initData: " +
        (data?.byteLength || 0) + " bytes",
    };
  });
  wrapProto(window.MediaKeySession, "update", function (args) {
    const r = args[0];
    const hex = r ? bytesToHex(r) : "";
    return {
      sessionId: this.sessionId || "unknown",
      matchTarget: (this.sessionId || "") + " " + hex,
      detail: "Response: " + (r?.byteLength || 0) + " bytes",
    };
  });
  wrapProto(window.MediaKeySession, "close", function () {
    return {
      sessionId: this.sessionId || "unknown",
      matchTarget: this.sessionId || "",
      detail: "Session close requested",
    };
  });
  wrapProto(window.MediaKeySession, "remove", function () {
    return {
      sessionId: this.sessionId || "unknown",
      matchTarget: this.sessionId || "",
      detail: "License removal requested",
    };
  });

  return "installed";
})()
`;

export const DrmCapture = {
  get breakpoints() {
    return gBreakpoints;
  },

  get hits() {
    return gHits;
  },

  get triggers() {
    return gTriggers;
  },

  get started() {
    return gStarted;
  },

  get installerScript() {
    return DRM_CONTENT_INSTALLER;
  },

  get serializedBreakpoints() {
    return gBreakpoints.map(serializeBreakpoint);
  },

  // Returns a small JS expression that pushes the parent's breakpoints into
  // the content-side registry. Used by DrmTools after each mutation.
  buildSyncScript() {
    const json = JSON.stringify(gBreakpoints.map(serializeBreakpoint));
    return `
      (function () {
        const root = window.__mcpDrmCapture__;
        if (!root) return "not-installed";
        root.breakpoints = ${json};
        return root.breakpoints.length;
      })()
    `;
  },

  // Returns a JS expression that drains and clears content-side hits +
  // triggers, and returns them as JSON. Called by MCP tools to merge
  // content-recorded data into the parent registry.
  buildDrainScript() {
    return `
      (function () {
        const root = window.__mcpDrmCapture__;
        if (!root) return JSON.stringify({ hits: [], triggers: [] });
        const hits = root.hits.splice(0);
        const triggers = root.triggers.splice(0);
        return JSON.stringify({ hits, triggers });
      })()
    `;
  },

  // Merges drained data into the parent registry. Called by MCP tools.
  ingestDrained(payload) {
    if (!payload) {
      return;
    }
    let parsed;
    try {
      parsed = typeof payload === "string" ? JSON.parse(payload) : payload;
    } catch {
      return;
    }
    if (Array.isArray(parsed.hits)) {
      for (const hit of parsed.hits) {
        gHits.push(hit);
        // Update local breakpoint hit counters too.
        const bp = gBreakpoints.find(b => b.id === hit.bpId);
        if (bp) {
          bp.hits = (bp.hits || 0) + 1;
          bp.lastHit = hit.timestamp;
        }
      }
      pruneHits();
    }
    if (Array.isArray(parsed.triggers)) {
      for (const t of parsed.triggers) {
        gTriggers.push(t);
      }
      pruneTriggers();
    }
  },

  start() {
    if (gStarted) {
      return;
    }
    gStarted = true;
    lazy.logger.info("MCP: DRM capture started");
  },

  stop() {
    if (!gStarted) {
      return;
    }
    gStarted = false;
    lazy.logger.info("MCP: DRM capture stopped");
  },

  clear() {
    gHits.length = 0;
    gTriggers.length = 0;
  },

  addBreakpoint(spec) {
    const bp = {
      id: `drm-bp-${++gIdCounter}`,
      method: spec?.method || "ANY",
      keySystem: spec?.keySystem || null,
      initDataType: spec?.initDataType || null,
      pattern: spec?.pattern || null,
      matchType: spec?.matchType || "substring",
      cancelOnHit: !!spec?.cancelOnHit,
      pauseOnHit: !!spec?.pauseOnHit,
      enabled: spec?.enabled !== false,
      hits: 0,
      lastHit: null,
    };
    if (
      bp.matchType !== "substring" &&
      bp.matchType !== "wildcard" &&
      bp.matchType !== "regex"
    ) {
      throw new Error(`Invalid matchType: ${bp.matchType}`);
    }
    compileBreakpoint(bp);
    if (bp._compileError) {
      throw new Error(`Invalid ${bp.matchType} pattern: ${bp._compileError}`);
    }
    gBreakpoints.push(bp);
    return serializeBreakpoint(bp);
  },

  removeBreakpoint(id) {
    if (id === undefined) {
      const removed = gBreakpoints.length;
      gBreakpoints.length = 0;
      return removed;
    }
    let removed = 0;
    for (let i = gBreakpoints.length - 1; i >= 0; i--) {
      if (gBreakpoints[i].id === id) {
        gBreakpoints.splice(i, 1);
        removed++;
      }
    }
    return removed;
  },

  updateBreakpoint(id, patch) {
    const bp = gBreakpoints.find(b => b.id === id);
    if (!bp) {
      return null;
    }
    if (patch && typeof patch === "object") {
      for (const key of [
        "method",
        "keySystem",
        "initDataType",
        "pattern",
        "matchType",
        "cancelOnHit",
        "pauseOnHit",
        "enabled",
      ]) {
        if (key in patch) {
          bp[key] = patch[key];
        }
      }
      compileBreakpoint(bp);
    }
    return serializeBreakpoint(bp);
  },

  clearBreakpointHits() {
    gHits.length = 0;
  },

  clearTriggers() {
    gTriggers.length = 0;
  },
};
