/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// DISCLAIMER: This file is part of an unofficial Firefox modification that adds
// DRM/EME debugging tools. It is NOT endorsed by or affiliated with Mozilla.
// The DRM media capture functionality bypasses content protection restrictions
// and is intended ONLY for developer debugging and testing purposes.
// Do NOT use in production or to circumvent digital rights management.

"use strict";

const { Actor } = require("resource://devtools/shared/protocol.js");
const { drmSpec } = require("resource://devtools/shared/specs/drm.js");

const EME_PREFS = [
  "media.eme.enabled",
  "media.eme.encrypted-media-encryption-scheme.enabled",
  "media.eme.hdcp-policy-check.enabled",
  "media.eme.playready.enabled",
  "media.eme.widevine.experiment.enabled",
  "media.gmp-widevinecdm.enabled",
  "media.gmp-widevinecdm.visible",
  "media.gmp-widevinecdm.autoupdate",
  "media.gmp.decoder.enabled",
  "media.eme.wmf.clearkey.enabled",
  "media.wmf.media-engine.enabled",
];

const KEY_SYSTEMS = [
  { keySystem: "org.w3.clearkey", label: "ClearKey" },
  { keySystem: "com.widevine.alpha", label: "Widevine" },
  {
    keySystem: "com.microsoft.playready.recommendation",
    label: "PlayReady (Software)",
  },
  {
    keySystem: "com.microsoft.playready.recommendation.3000",
    label: "PlayReady (Hardware)",
    hardwareDecryption: true,
  },
];

const PROBE_CONFIGS = [
  {
    initDataTypes: ["cenc", "keyids", "webm"],
    videoCapabilities: [
      { contentType: 'video/mp4; codecs="avc1.42E01E"' },
      { contentType: 'video/mp4; codecs="avc1.640028"' },
      { contentType: 'video/webm; codecs="vp9"' },
      { contentType: 'video/mp4; codecs="hev1.1.6.L93.B0"' },
      { contentType: 'video/mp4; codecs="av01.0.01M.08"' },
    ],
    audioCapabilities: [
      { contentType: 'audio/mp4; codecs="mp4a.40.2"' },
      { contentType: 'audio/webm; codecs="opus"' },
    ],
  },
];

// Well-known PSSH system IDs
const SYSTEM_IDS = {
  "1077efecc0b24d02ace33c1e52e2fb4b": "ClearKey",
  edef8ba979d64acea3c827dcd51d21ed: "Widevine",
  "9a04f07998404286ab92e65be0885f95": "PlayReady",
  f239e769efa348509c16a903c6932efb: "PrimeTime",
  "6dd8b3c345f44a68bf3a64168d01a4a6": "ABV",
  adb41c242dbf4a6d958b4457c0d27b95: "Nagra",
  "94ce86fb07ff4f43adb893d2fa968ca2": "FairPlay",
};

// ---- utility helpers ----

function bufferToHex(buffer) {
  try {
    return Array.from(new Uint8Array(buffer))
      .map(b => b.toString(16).padStart(2, "0"))
      .join("");
  } catch {
    return "";
  }
}

function bufferToBase64(buffer) {
  try {
    const bytes = new Uint8Array(buffer);
    let binary = "";
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  } catch {
    return "";
  }
}

function tryDecodeUtf8(buffer) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(
      new Uint8Array(buffer)
    );
  } catch {
    return null;
  }
}

function tryParseJson(str) {
  try {
    return JSON.parse(str);
  } catch {
    return null;
  }
}

function captureStack() {
  const err = new Error();
  if (!err.stack) {
    return null;
  }
  const lines = err.stack.split("\n");
  return lines.slice(2).join("\n") || null;
}

function serializeConfig(config) {
  if (!config) {
    return null;
  }
  try {
    return {
      label: config.label || "",
      initDataTypes: Array.from(config.initDataTypes || []),
      audioCapabilities: Array.from(config.audioCapabilities || []).map(c => ({
        contentType: c.contentType,
        robustness: c.robustness || "",
        encryptionScheme: c.encryptionScheme || null,
      })),
      videoCapabilities: Array.from(config.videoCapabilities || []).map(c => ({
        contentType: c.contentType,
        robustness: c.robustness || "",
        encryptionScheme: c.encryptionScheme || null,
      })),
      distinctiveIdentifier: config.distinctiveIdentifier || "not-allowed",
      persistentState: config.persistentState || "not-allowed",
      sessionTypes: Array.from(config.sessionTypes || []),
    };
  } catch {
    return null;
  }
}

function serializeCandidateConfigs(configs) {
  try {
    return Array.from(configs).map(c => ({
      label: c.label || "",
      initDataTypes: c.initDataTypes ? Array.from(c.initDataTypes) : [],
      audioCapabilities: c.audioCapabilities
        ? Array.from(c.audioCapabilities).map(a => ({
            contentType: a.contentType,
            robustness: a.robustness || "",
          }))
        : [],
      videoCapabilities: c.videoCapabilities
        ? Array.from(c.videoCapabilities).map(v => ({
            contentType: v.contentType,
            robustness: v.robustness || "",
          }))
        : [],
      distinctiveIdentifier: c.distinctiveIdentifier || "",
      persistentState: c.persistentState || "",
      sessionTypes: c.sessionTypes ? Array.from(c.sessionTypes) : [],
    }));
  } catch {
    return [];
  }
}

// Parse PSSH boxes from CENC init data
function parsePsshBoxes(buffer) {
  const boxes = [];
  try {
    const data = new Uint8Array(buffer);
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    let offset = 0;
    while (offset + 8 <= data.byteLength) {
      const size = view.getUint32(offset);
      if (size < 8 || offset + size > data.byteLength) {
        break;
      }
      const type = String.fromCharCode(
        data[offset + 4],
        data[offset + 5],
        data[offset + 6],
        data[offset + 7]
      );
      if (type === "pssh" && size >= 32) {
        const version = data[offset + 8];
        const systemIdHex = bufferToHex(data.slice(offset + 12, offset + 28));
        const systemName = SYSTEM_IDS[systemIdHex] || "Unknown";
        const box = {
          version,
          systemId: systemIdHex,
          systemName,
          boxSize: size,
        };
        let innerOffset = 28;
        if (version >= 1 && innerOffset + 4 <= size) {
          const kidCount = view.getUint32(offset + innerOffset);
          innerOffset += 4;
          box.keyIds = [];
          for (let i = 0; i < kidCount && innerOffset + 16 <= size; i++) {
            box.keyIds.push(
              bufferToHex(
                data.slice(offset + innerOffset, offset + innerOffset + 16)
              )
            );
            innerOffset += 16;
          }
        }
        if (innerOffset + 4 <= size) {
          const dataSize = view.getUint32(offset + innerOffset);
          innerOffset += 4;
          if (dataSize > 0 && innerOffset + dataSize <= size) {
            box.data = bufferToHex(
              data.slice(
                offset + innerOffset,
                offset + innerOffset + Math.min(dataSize, 256)
              )
            );
            box.dataSize = dataSize;
          }
        }
        boxes.push(box);
      }
      offset += size;
    }
  } catch {
    // Malformed
  }
  return boxes;
}

// Parse keyids-format init data (JSON)
function parseKeyIdsInitData(buffer) {
  const text = tryDecodeUtf8(buffer);
  if (!text) {
    return null;
  }
  const obj = tryParseJson(text);
  if (!obj) {
    return null;
  }
  return obj;
}

// Parse a ClearKey license message body (JSON-encoded JWK request or response)
function parseClearKeyMessage(buffer) {
  const text = tryDecodeUtf8(buffer);
  if (!text) {
    return null;
  }
  const obj = tryParseJson(text);
  if (!obj) {
    return null;
  }
  return obj;
}

function serializeTimeRanges(ranges) {
  const result = [];
  try {
    for (let i = 0; i < ranges.length; i++) {
      result.push({ start: ranges.start(i), end: ranges.end(i) });
    }
  } catch {
    /* Ignore */
  }
  return result;
}

function readChromeOnlyProp(w, prop) {
  try {
    return w[prop];
  } catch {
    return undefined;
  }
}

function collectChromeOnlyProps(w, info) {
  const props = [
    "isEncrypted",
    "isVideoDecodingSuspended",
    "totalVideoPlayTime",
    "visiblePlayTime",
    "invisiblePlayTime",
    "totalAudioPlayTime",
    "audiblePlayTime",
    "inaudiblePlayTime",
    "mutedPlayTime",
  ];
  for (const prop of props) {
    const val = readChromeOnlyProp(w, prop);
    if (val !== undefined) {
      info[prop] = val;
    }
  }
}

function collectPlaybackQuality(w, info) {
  try {
    if (w.getVideoPlaybackQuality) {
      const q = w.getVideoPlaybackQuality();
      info.playbackQuality = {
        creationTime: q.creationTime,
        totalVideoFrames: q.totalVideoFrames,
        droppedVideoFrames: q.droppedVideoFrames,
      };
    }
  } catch {
    /* Ignore */
  }
}

function getMediaElementInfo(el) {
  try {
    const w = Cu.waiveXrays(el);
    const info = {
      tagName: w.tagName?.toLowerCase(),
      src: w.currentSrc || w.src || "",
      readyState: w.readyState,
      networkState: w.networkState,
      paused: w.paused,
      ended: w.ended,
      seeking: w.seeking,
      currentTime: w.currentTime,
      duration: isFinite(w.duration) ? w.duration : null,
      playbackRate: w.playbackRate,
      defaultPlaybackRate: w.defaultPlaybackRate,
      volume: w.volume,
      muted: w.muted,
      defaultMuted: w.defaultMuted,
      loop: w.loop,
      autoplay: w.autoplay,
      preload: w.preload,
      crossOrigin: w.crossOrigin,
      videoWidth: w.videoWidth || 0,
      videoHeight: w.videoHeight || 0,
      buffered: serializeTimeRanges(w.buffered),
      played: serializeTimeRanges(w.played),
      seekable: serializeTimeRanges(w.seekable),
      error: w.error
        ? { code: w.error.code, message: w.error.message || "" }
        : null,
    };

    collectChromeOnlyProps(w, info);
    collectPlaybackQuality(w, info);

    try {
      if (w.mozGetMetadata) {
        info.metadata = Cu.cloneInto(w.mozGetMetadata(), {});
      }
    } catch {
      /* Ignore */
    }

    return info;
  } catch {
    return null;
  }
}

function parseTrackState(state) {
  if (!state) {
    return null;
  }
  return {
    needInput: state.needInput,
    waitingForData: state.waitingForData,
    waitingForKey: state.waitingForKey,
    demuxQueueSize: state.demuxQueueSize,
    numSamplesInput: state.numSamplesInput,
    numSamplesOutput: state.numSamplesOutput,
    queueSize: state.queueSize,
    pending: state.pending,
    hasDecoder: state.hasDecoder,
  };
}

function parseDecoderReader(r) {
  const reader = {
    videoType: r.videoType || "",
    videoDecoderName: r.videoDecoderName || "",
    videoWidth: r.videoWidth,
    videoHeight: r.videoHeight,
    videoRate: r.videoRate,
    videoHardwareAccelerated: r.videoHardwareAccelerated,
    videoNumSamplesOutputTotal: r.videoNumSamplesOutputTotal,
    videoNumSamplesSkippedTotal: r.videoNumSamplesSkippedTotal,
    audioType: r.audioType || "",
    audioDecoderName: r.audioDecoderName || "",
    audioChannels: r.audioChannels,
    audioRate: r.audioRate,
    audioFramesDecoded: r.audioFramesDecoded,
    totalReadMetadataTimeMs: r.totalReadMetadataTimeMs,
    totalWaitingForVideoDataTimeMs: r.totalWaitingForVideoDataTimeMs,
  };
  if (r.frameStats) {
    reader.frameStats = {
      droppedDecodedFrames: r.frameStats.droppedDecodedFrames,
      droppedSinkFrames: r.frameStats.droppedSinkFrames,
      droppedCompositorFrames: r.frameStats.droppedCompositorFrames,
    };
  }
  if (r.videoState) {
    reader.videoState = parseTrackState(r.videoState);
  }
  if (r.audioState) {
    reader.audioState = parseTrackState(r.audioState);
  }
  return reader;
}

function parseMediaSink(sink) {
  const mediaSink = {};
  if (sink.audioSinkWrapper?.audioSink) {
    const as = sink.audioSinkWrapper.audioSink;
    mediaSink.audio = {
      isPlaying: as.isPlaying,
      isStarted: as.isStarted,
      audioEnded: as.audioEnded,
      outputRate: as.outputRate,
      written: as.written,
      hasErrored: as.hasErrored,
      playbackComplete: as.playbackComplete,
    };
  }
  if (sink.videoSink) {
    mediaSink.video = {
      isStarted: sink.videoSink.isStarted,
      isPlaying: sink.videoSink.isPlaying,
      finished: sink.videoSink.finished,
      size: sink.videoSink.size,
      hasVideo: sink.videoSink.hasVideo,
    };
  }
  return mediaSink;
}

function parseDecoderInfo(dec, result) {
  result.decoder = {
    instance: dec.instance || "",
    channels: dec.channels,
    rate: dec.rate,
    hasAudio: dec.hasAudio,
    hasVideo: dec.hasVideo,
    playState: dec.PlayState || "",
    containerType: dec.containerType || "",
  };
  if (dec.reader) {
    result.decoder.reader = parseDecoderReader(dec.reader);
  }
  if (dec.stateMachine) {
    const sm = dec.stateMachine;
    result.decoder.stateMachine = {
      duration: sm.duration,
      mediaTime: sm.mediaTime,
      clock: sm.clock,
      state: sm.state || "",
      playState: sm.playState,
      isPlaying: sm.isPlaying,
      audioCompleted: sm.audioCompleted,
      videoCompleted: sm.videoCompleted,
      totalBufferingTimeMs: sm.totalBufferingTimeMs,
    };
    if (sm.mediaSink) {
      result.decoder.mediaSink = parseMediaSink(sm.mediaSink);
    }
  }
  if (dec.resource?.cacheStream) {
    const cs = dec.resource.cacheStream;
    result.decoder.cache = {
      streamLength: cs.streamLength,
      channelOffset: cs.channelOffset,
      cacheSuspended: cs.cacheSuspended,
      channelEnded: cs.channelEnded,
      loadID: cs.loadID,
    };
  }
}

function parseMediaSourceDebug(d) {
  const mediaSource = {};
  if (d.demuxer) {
    mediaSource.demuxer = {};
    if (d.demuxer.audioTrack) {
      mediaSource.demuxer.audioTrack = {
        type: d.demuxer.audioTrack.type || "",
        numSamples: d.demuxer.audioTrack.numSamples,
        bufferSize: d.demuxer.audioTrack.bufferSize,
        evictable: d.demuxer.audioTrack.evictable,
      };
    }
    if (d.demuxer.videoTrack) {
      mediaSource.demuxer.videoTrack = {
        type: d.demuxer.videoTrack.type || "",
        numSamples: d.demuxer.videoTrack.numSamples,
        bufferSize: d.demuxer.videoTrack.bufferSize,
        evictable: d.demuxer.videoTrack.evictable,
      };
    }
  }
  return mediaSource;
}

async function getDeepDebugInfo(el) {
  const w = Cu.waiveXrays(el);
  const result = {};

  try {
    if (w.mozRequestDebugInfo) {
      const dbg = await w.mozRequestDebugInfo();
      const d = Cu.waiveXrays(dbg);
      result.debugInfo = {
        compositorDroppedFrames: d.compositorDroppedFrames,
        emeInfo: {
          keySystem: d.EMEInfo?.keySystem || "",
          sessionsInfo: d.EMEInfo?.sessionsInfo || "",
        },
      };
      if (d.decoder) {
        parseDecoderInfo(d.decoder, result);
      }
    }
  } catch {
    // mozRequestDebugInfo not available
  }

  try {
    if (w.mozRequestDebugLog) {
      result.debugLog = await w.mozRequestDebugLog();
    }
  } catch {
    // Ignore
  }

  try {
    if (w.mozMediaSourceObject && w.mozMediaSourceObject.mozDebugReaderData) {
      const msd = await Cu.waiveXrays(
        w.mozMediaSourceObject
      ).mozDebugReaderData();
      result.mediaSource = parseMediaSourceDebug(Cu.waiveXrays(msd));
    }
  } catch {
    // Ignore
  }

  return result;
}

function nowMs() {
  try {
    return performance.now();
  } catch {
    return Date.now();
  }
}

const DRM_TRIGGER_METHODS = new Set([
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
]);

const MAX_DRM_BREAKPOINT_HITS = 200;
const MAX_DRM_TRIGGERS = 500;

function _drmWildcardToRegExp(glob) {
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

function _compileDrmBreakpointPattern(bp) {
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
      bp._matcher = _drmWildcardToRegExp(bp.pattern);
    }
  } catch (e) {
    bp._compileError = e.message;
  }
  return bp._matcher;
}

function _drmBreakpointMatchesContext(bp, method, ctx) {
  if (bp.enabled === false) {
    return false;
  }
  if (bp.method && bp.method !== "ANY" && bp.method !== method) {
    return false;
  }
  if (bp.keySystem && !(ctx.keySystem || "").includes(bp.keySystem)) {
    return false;
  }
  if (bp.initDataType && bp.initDataType !== ctx.initDataType) {
    return false;
  }
  if (bp.pattern) {
    const re = _compileDrmBreakpointPattern(bp);
    const haystack = ctx.matchTarget || "";
    if (re) {
      if (!re.test(haystack)) {
        return false;
      }
    } else if (!haystack.includes(bp.pattern)) {
      return false;
    }
  }
  return true;
}

function _serializeDrmBreakpoint(bp) {
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

exports.DrmActor = class DrmActor extends Actor {
  constructor(conn, targetActor) {
    super(conn, drmSpec);
    this._targetActor = targetActor;
    this._trackedSessions = new Map();
    this._trackedMediaElements = new Map();
    this._observing = false;
    this._mutationObserver = null;
    this._eventLog = [];
    this._accessConfigs = new Map();
    this._originals = {};
    this._captureRawData = false;
    this._activeRecordings = new Map();
    this._drmBreakpoints = [];
    this._drmBreakpointHits = [];
    this._drmBreakpointIdCounter = 0;
    this._triggers = [];
  }

  destroy() {
    for (const [, rec] of this._activeRecordings) {
      try {
        rec.recorder.stop();
      } catch {
        /* Ignore */
      }
    }
    this._activeRecordings.clear();
    this.stopObserving();
    super.destroy();
  }

  get _window() {
    return this._targetActor.window;
  }

  get _contentWindow() {
    const win = this._window;
    return win ? Cu.waiveXrays(win) : null;
  }

  _withTimeout(promise, ms) {
    return Promise.race([
      promise,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Timeout")), ms)
      ),
    ]);
  }

  async getKeySystemAvailability() {
    const win = this._window;
    if (!win || !win.navigator) {
      return [];
    }
    const results = [];
    for (const ks of KEY_SYSTEMS) {
      let available = false;
      let resolvedConfig = null;
      let probeTimeMs = 0;
      const t0 = nowMs();
      try {
        const access = await this._withTimeout(
          win.navigator.requestMediaKeySystemAccess(
            ks.keySystem,
            PROBE_CONFIGS
          ),
          5000
        );
        available = true;
        resolvedConfig = serializeConfig(access.getConfiguration());
      } catch {
        // Not available or timed out
      }
      probeTimeMs = Math.round(nowMs() - t0);
      results.push({
        keySystem: ks.keySystem,
        label: ks.label,
        available,
        hardwareDecryption: !!ks.hardwareDecryption,
        resolvedConfig,
        probeTimeMs,
      });
    }
    return results;
  }

  _readSessionKeyStatuses(session) {
    const keyStatuses = [];
    try {
      const waived = Cu.waiveXrays(session);
      for (const [keyId, status] of waived.keyStatuses) {
        keyStatuses.push({ keyId: bufferToHex(keyId), status });
      }
    } catch {
      // Closed
    }
    return keyStatuses;
  }

  _readSessionErrorInfo(session) {
    try {
      const waived = Cu.waiveXrays(session);
      if (waived.error) {
        return {
          systemCode: waived.error.systemCode,
          message: waived.error.message || "",
        };
      }
    } catch {
      // Ignore
    }
    return null;
  }

  _readSessionExpiration(session) {
    try {
      return Cu.waiveXrays(session).expiration;
    } catch {
      return NaN;
    }
  }

  _serializeSession(sessionId, info) {
    return {
      sessionId,
      sessionType: info.sessionType,
      keySystem: info.keySystem || "",
      expiration: this._readSessionExpiration(info.session),
      keyStatuses: this._readSessionKeyStatuses(info.session),
      closed: info.closed,
      closedReason: info.closedReason || null,
      errorInfo: this._readSessionErrorInfo(info.session),
      initDataType: info.initDataType || null,
      initDataHex: info.initDataHex || null,
      initDataSize: info.initDataSize || 0,
      parsedInitData: info.parsedInitData || null,
      createdStack: info.createdStack || null,
      generateRequestStack: info.generateRequestStack || null,
      messageCount: info.messageCount || 0,
      lastMessageType: info.lastMessageType || null,
      lastMessageSize: info.lastMessageSize || 0,
      errors: info.errors || [],
      timeline: info.timeline || [],
      licenseExchanges: info.licenseExchanges || [],
      keyStatusHistory: info.keyStatusHistory || [],
      mediaElementInfo: info.mediaElementInfo || null,
      serverCertificateSet: info.serverCertificateSet || false,
      totalBytesReceived: info.totalBytesReceived || 0,
      totalBytesSent: info.totalBytesSent || 0,
      createdAt: info.createdAt || 0,
      firstKeyUsableAt: info.firstKeyUsableAt || null,
      closedAt: info.closedAt || null,
    };
  }

  getActiveSessions() {
    const sessions = [];
    for (const [sessionId, info] of this._trackedSessions) {
      sessions.push(this._serializeSession(sessionId, info));
    }
    return sessions;
  }

  getEMEConfig() {
    const config = [];
    for (const name of EME_PREFS) {
      let value;
      let type = "boolean";
      try {
        value = Services.prefs.getBoolPref(name, undefined);
        if (value === undefined) {
          value = Services.prefs.getCharPref(name, undefined);
          type = value !== undefined ? "string" : "unknown";
        }
      } catch {
        value = undefined;
        type = "unknown";
      }
      config.push({ name, value, type });
    }
    return config;
  }

  setEMEPref(name, value) {
    if (!EME_PREFS.includes(name)) {
      return { success: false, error: "Pref not in allowlist" };
    }
    try {
      if (typeof value === "boolean") {
        Services.prefs.setBoolPref(name, value);
      } else if (typeof value === "number") {
        Services.prefs.setIntPref(name, value);
      } else {
        Services.prefs.setCharPref(name, String(value));
      }
      return { success: true };
    } catch (e) {
      return { success: false, error: `Cannot set pref: ${e.message}` };
    }
  }

  getDiagnostics() {
    const diagnostics = [];
    try {
      if (!Services.prefs.getBoolPref("media.eme.enabled", false)) {
        diagnostics.push({
          severity: "error",
          message: "EME is disabled",
          detail:
            "Set media.eme.enabled to true in about:config to enable DRM playback.",
        });
      }
    } catch {
      /* Ignore */
    }

    try {
      if (!Services.prefs.getBoolPref("media.gmp-widevinecdm.enabled", false)) {
        diagnostics.push({
          severity: "warning",
          message: "Widevine CDM is disabled",
          detail:
            "Set media.gmp-widevinecdm.enabled to true to enable Widevine.",
        });
      }
    } catch {
      /* Ignore */
    }

    for (const [sessionId, info] of this._trackedSessions) {
      if (info.errors && info.errors.length) {
        for (const err of info.errors) {
          diagnostics.push({
            severity: "error",
            message: `Error in session ${sessionId}`,
            detail:
              `Type: ${err.type}, ${err.name}: ${err.message}` +
              (err.systemCode ? ` (system code: ${err.systemCode})` : "") +
              (err.stack ? `\nStack: ${err.stack}` : ""),
          });
        }
      }

      try {
        const waived = Cu.waiveXrays(info.session);
        for (const [keyId, status] of waived.keyStatuses) {
          if (
            status === "output-restricted" ||
            status === "output-downscaled"
          ) {
            diagnostics.push({
              severity: "warning",
              message: "Output protection issue",
              detail: `Session ${sessionId}, key ${bufferToHex(keyId)}: "${status}" - HDCP or output protection requirements not met.`,
            });
          } else if (status === "internal-error") {
            diagnostics.push({
              severity: "error",
              message: "CDM internal error",
              detail: `Session ${sessionId}, key ${bufferToHex(keyId)}: internal-error.`,
            });
          } else if (status === "expired") {
            diagnostics.push({
              severity: "warning",
              message: "Key expired",
              detail: `Session ${sessionId}, key ${bufferToHex(keyId)}: key has expired.`,
            });
          }
        }
      } catch {
        // Closed
      }

      // Check if license exchange took too long
      if (info.licenseExchanges.length) {
        const last = info.licenseExchanges[info.licenseExchanges.length - 1];
        if (last.durationMs && last.durationMs > 5000) {
          diagnostics.push({
            severity: "warning",
            message: `Slow license exchange in session ${sessionId}`,
            detail: `License exchange took ${last.durationMs}ms. This may cause playback delays.`,
          });
        }
      }
    }

    if (diagnostics.length === 0) {
      diagnostics.push({
        severity: "info",
        message: "No issues detected",
        detail: "EME configuration appears correct.",
      });
    }

    return diagnostics;
  }

  getEventLog() {
    return this._eventLog;
  }

  // Find the HTMLMediaElement associated with a tracked session
  _getMediaElementForSession(sessionId) {
    const info = this._trackedSessions.get(sessionId);
    if (!info) {
      return null;
    }
    // Walk the MediaKeys -> element map
    for (const [mk, el] of this._trackedMediaElements) {
      try {
        // Check if this MediaKeys created this session by checking keySystem match
        // and verifying the element's mediaKeys is the same object
        const elWaived = Cu.waiveXrays(el);
        if (elWaived.mediaKeys && Cu.waiveXrays(elWaived.mediaKeys) === mk) {
          return el;
        }
      } catch {
        // Ignore
      }
    }
    // Fallback: scan all video/audio elements, prefer matching key system
    const win = this._window;
    if (!win) {
      return null;
    }
    let fallback = null;
    for (const el of win.document.querySelectorAll("video, audio")) {
      try {
        const elWaived = Cu.waiveXrays(el);
        if (!elWaived.mediaKeys) {
          continue;
        }
        // Prefer element whose keySystem matches
        if (info.keySystem && elWaived.mediaKeys.keySystem === info.keySystem) {
          return el;
        }
        if (!fallback) {
          fallback = el;
        }
      } catch {
        // Ignore
      }
    }
    return fallback;
  }

  captureVideoFrame(sessionId) {
    const el = this._getMediaElementForSession(sessionId);
    if (!el) {
      return { error: "No media element found for session" };
    }
    const w = Cu.waiveXrays(el);
    if (w.tagName?.toLowerCase() !== "video") {
      return { error: "Media element is <audio>, cannot capture frame" };
    }
    if (w.readyState < 2) {
      return { error: "Video not ready (readyState=" + w.readyState + ")" };
    }

    const width = w.videoWidth || 640;
    const height = w.videoHeight || 360;

    try {
      const win = this._window;
      const canvas = win.document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(w, 0, 0, width, height);

      // Check if the frame is all black (potential decryption failure)
      const sampleSize = 64;
      const sample = ctx.getImageData(
        Math.floor(width / 4),
        Math.floor(height / 4),
        sampleSize,
        sampleSize
      );
      let totalBrightness = 0;
      for (let i = 0; i < sample.data.length; i += 4) {
        totalBrightness +=
          sample.data[i] + sample.data[i + 1] + sample.data[i + 2];
      }
      const avgBrightness = totalBrightness / (sampleSize * sampleSize * 3);
      const isBlackFrame = avgBrightness < 5;

      const dataUrl = canvas.toDataURL("image/png");

      this._addEvent(
        "frame-captured",
        sessionId,
        `${width}x${height} at ${w.currentTime.toFixed(3)}s` +
          (isBlackFrame ? " (BLACK FRAME - possible decryption issue)" : ""),
        null,
        {
          width,
          height,
          currentTime: w.currentTime,
          isBlackFrame,
          avgBrightness: Math.round(avgBrightness),
        }
      );

      return {
        dataUrl,
        width,
        height,
        currentTime: w.currentTime,
        duration: isFinite(w.duration) ? w.duration : null,
        isBlackFrame,
        avgBrightness: Math.round(avgBrightness),
        paused: w.paused,
        readyState: w.readyState,
      };
    } catch (e) {
      return { error: "Frame capture failed: " + e.message };
    }
  }

  _buildElementState(w) {
    return {
      tagName: w.tagName?.toLowerCase(),
      src: w.currentSrc || w.src || "",
      readyState: w.readyState,
      networkState: w.networkState,
      paused: w.paused,
      ended: w.ended,
      seeking: w.seeking,
      currentTime: w.currentTime,
      duration: isFinite(w.duration) ? w.duration : null,
      playbackRate: w.playbackRate,
      volume: w.volume,
      muted: w.muted,
      videoWidth: w.videoWidth || 0,
      videoHeight: w.videoHeight || 0,
      buffered: serializeTimeRanges(w.buffered),
      error: w.error
        ? { code: w.error.code, message: w.error.message || "" }
        : null,
    };
  }

  _buildDrmState(sessionId, info) {
    return {
      keySystem: info?.keySystem || "",
      sessionId,
      sessionType: info?.sessionType || "",
      messageCount: info?.messageCount || 0,
      totalBytesSent: info?.totalBytesSent || 0,
      totalBytesReceived: info?.totalBytesReceived || 0,
      errorCount: info?.errors?.length || 0,
      closed: info?.closed || false,
      keyStatuses: info ? this._readSessionKeyStatuses(info.session) : [],
    };
  }

  getSessionMediaState(sessionId) {
    const el = this._getMediaElementForSession(sessionId);
    if (!el) {
      return { error: "No media element found for session" };
    }
    const w = Cu.waiveXrays(el);
    const info = this._trackedSessions.get(sessionId);

    return {
      element: this._buildElementState(w),
      drm: this._buildDrmState(sessionId, info),
      recording: this._activeRecordings.has(sessionId),
    };
  }

  async getSessionDeepDebug(sessionId) {
    const el = this._getMediaElementForSession(sessionId);
    if (!el) {
      return { error: "No media element found for session" };
    }
    const info = this._trackedSessions.get(sessionId);
    const result = {
      sessionId,
      timestamp: Date.now(),
      element: getMediaElementInfo(el),
    };

    // Deep debug info from mozRequestDebugInfo
    try {
      const deep = await getDeepDebugInfo(el);
      Object.assign(result, deep);
    } catch (e) {
      result.debugError = e.message;
    }

    // Session-specific data
    if (info) {
      result.session = {
        sessionType: info.sessionType,
        keySystem: info.keySystem,
        closed: info.closed,
        closedReason: info.closedReason,
        createdAt: info.createdAt,
        closedAt: info.closedAt,
        firstKeyUsableAt: info.firstKeyUsableAt,
        messageCount: info.messageCount,
        totalBytesSent: info.totalBytesSent,
        totalBytesReceived: info.totalBytesReceived,
        errorCount: info.errors?.length || 0,
        initDataType: info.initDataType,
        initDataSize: info.initDataSize,
        timelineLength: info.timeline?.length || 0,
        licenseExchangeCount: info.licenseExchanges?.length || 0,
        keyStatusHistoryLength: info.keyStatusHistory?.length || 0,
      };
    }

    // Current key statuses
    result.keyStatuses = [];
    try {
      const waived = Cu.waiveXrays(info.session);
      for (const [keyId, status] of waived.keyStatuses) {
        result.keyStatuses.push({ keyId: bufferToHex(keyId), status });
      }
    } catch {
      // Ignore
    }

    result.emeCaptureAllowed = Services.prefs.getBoolPref(
      "media.eme.capture-allowed",
      false
    );

    return result;
  }

  startStreamRecording(sessionId) {
    if (this._activeRecordings.has(sessionId)) {
      return { error: "Already recording this session" };
    }
    const el = this._getMediaElementForSession(sessionId);
    if (!el) {
      return { error: "No media element found for session" };
    }
    const w = Cu.waiveXrays(el);
    const isVideo = w.tagName?.toLowerCase() === "video";

    // Debug: log the pref value as seen from the content process
    const captureAllowed = Services.prefs.getBoolPref(
      "media.eme.capture-allowed",
      false
    );
    this._addEvent(
      "stream-recording-debug",
      sessionId,
      `<${w.tagName?.toLowerCase()}> captureAllowed=${captureAllowed}, ` +
        `hasMediaKeys=${!!w.mediaKeys}, readyState=${w.readyState}, ` +
        `paused=${w.paused}, src=${(w.currentSrc || w.src || "").substring(0, 100)}`,
      null,
      {
        captureAllowed,
        hasMediaKeys: !!w.mediaKeys,
        isVideo,
        readyState: w.readyState,
        paused: w.paused,
      }
    );

    try {
      const stream = w.mozCaptureStream
        ? w.mozCaptureStream()
        : w.captureStream();

      // Pick a supported mime type based on element type
      const win = this._window;
      const MR = Cu.waiveXrays(win).MediaRecorder;
      let mimeType = "";
      const candidates = isVideo
        ? [
            "video/webm;codecs=vp8,opus",
            "video/webm;codecs=vp9,opus",
            "video/webm",
          ]
        : ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"];
      for (const candidate of candidates) {
        try {
          if (MR.isTypeSupported(candidate)) {
            mimeType = candidate;
            break;
          }
        } catch {
          // Ignore
        }
      }

      const recorder = new MR(stream, mimeType ? { mimeType } : {});
      const chunks = [];
      const startTime = Date.now();

      recorder.ondataavailable = e => {
        if (e.data && e.data.size > 0) {
          chunks.push(e.data);
        }
      };

      recorder.onerror = e => {
        this._addEvent(
          "stream-recording-error",
          sessionId,
          `MediaRecorder error: ${e.error?.name || "unknown"}: ${e.error?.message || ""}`,
          null,
          { error: e.error?.name, message: e.error?.message }
        );
      };

      recorder.start(1000);

      this._activeRecordings.set(sessionId, {
        recorder,
        chunks,
        startTime,
        mimeType: recorder.mimeType,
      });

      this._addEvent(
        "stream-recording-started",
        sessionId,
        `Recording decrypted stream (${recorder.mimeType})`,
        null,
        { mimeType: recorder.mimeType }
      );

      return {
        started: true,
        mimeType: recorder.mimeType,
      };
    } catch (e) {
      return { error: "Failed to start recording: " + e.message };
    }
  }

  async stopStreamRecording(sessionId) {
    const rec = this._activeRecordings.get(sessionId);
    if (!rec) {
      return { error: "No active recording for this session" };
    }

    return new Promise(resolve => {
      rec.recorder.onstop = () => {
        const durationMs = Date.now() - rec.startTime;
        this._activeRecordings.delete(sessionId);

        if (rec.chunks.length === 0) {
          this._addEvent(
            "stream-recording-stopped",
            sessionId,
            `Recording stopped after ${durationMs}ms - no data captured (decryption may have failed)`,
            null,
            { durationMs, dataSize: 0 }
          );
          resolve({
            durationMs,
            mimeType: rec.mimeType,
            dataSize: 0,
            dataUrl: null,
            warning:
              "No data captured. Decryption may have failed or video was not playing.",
          });
          return;
        }

        try {
          const blob = new Blob(rec.chunks, { type: rec.mimeType });
          const totalSize = blob.size;

          // Convert to data URL for transfer over RDP
          const reader = new FileReader();
          reader.onload = () => {
            this._addEvent(
              "stream-recording-stopped",
              sessionId,
              `Recording: ${durationMs}ms, ${totalSize} bytes (${rec.mimeType})`,
              null,
              { durationMs, dataSize: totalSize, mimeType: rec.mimeType }
            );
            resolve({
              durationMs,
              mimeType: rec.mimeType,
              dataSize: totalSize,
              dataUrl: reader.result,
            });
          };
          reader.onerror = () => {
            resolve({
              durationMs,
              mimeType: rec.mimeType,
              dataSize: totalSize,
              dataUrl: null,
              error: "Failed to encode recording",
            });
          };
          reader.readAsDataURL(blob);
        } catch (e) {
          resolve({ error: "Failed to process recording: " + e.message });
        }
      };

      try {
        rec.recorder.stop();
      } catch (e) {
        this._activeRecordings.delete(sessionId);
        resolve({ error: "Failed to stop recorder: " + e.message });
      }
    });
  }

  _wrapRequestMediaKeySystemAccess(cw, actor) {
    if (!cw.navigator.requestMediaKeySystemAccess) {
      return;
    }
    this._originals.requestMediaKeySystemAccess =
      cw.navigator.requestMediaKeySystemAccess.bind(cw.navigator);
    cw.navigator.requestMediaKeySystemAccess = function (keySystem, configs) {
      const stack = captureStack();
      const _bpHit = actor._emitDrmCallSite(
        "requestMediaKeySystemAccess",
        {
          keySystem: keySystem || "",
          matchTarget: keySystem || "",
          detail: `keySystem: ${keySystem}, configs: ${configs?.length || 0} candidate(s)`,
        },
        stack
      );
      if (_bpHit?.cancelOnHit) {
        throw new cw.DOMException(
          `DRM breakpoint canceled: ${_bpHit.id}`,
          "OperationError"
        );
      }
      const t0 = Date.now();
      const candidateConfigs = serializeCandidateConfigs(configs);
      actor._addEvent(
        "requestMediaKeySystemAccess",
        "",
        `keySystem: ${keySystem}, configs: ${configs.length} candidate(s)`,
        stack,
        { keySystem, candidateConfigs }
      );
      return actor._originals
        .requestMediaKeySystemAccess(keySystem, configs)
        .then(
          access => {
            const durationMs = Date.now() - t0;
            const resolved = serializeConfig(
              Cu.waiveXrays(access).getConfiguration()
            );
            actor._accessConfigs.set(keySystem, resolved);
            actor._addEvent(
              "mediaKeySystemAccess-granted",
              "",
              `keySystem: ${keySystem} (${durationMs}ms)`,
              null,
              { keySystem, resolvedConfig: resolved, durationMs }
            );
            return access;
          },
          err => {
            const durationMs = Date.now() - t0;
            actor._addEvent(
              "mediaKeySystemAccess-denied",
              "",
              `keySystem: ${keySystem}, error: ${err.message} (${durationMs}ms)`,
              stack,
              { keySystem, error: err.message, durationMs }
            );
            throw err;
          }
        );
    };
  }

  _wrapCreateMediaKeys(cw, actor) {
    if (
      !cw.MediaKeySystemAccess ||
      !cw.MediaKeySystemAccess.prototype.createMediaKeys
    ) {
      return;
    }
    this._originals.createMediaKeys =
      cw.MediaKeySystemAccess.prototype.createMediaKeys;
    cw.MediaKeySystemAccess.prototype.createMediaKeys = function () {
      const stack = captureStack();
      const ks = Cu.waiveXrays(this).keySystem || "";
      const _bpHit = actor._emitDrmCallSite(
        "createMediaKeys",
        {
          keySystem: ks,
          matchTarget: ks,
          detail: `keySystem: ${ks}`,
        },
        stack
      );
      if (_bpHit?.cancelOnHit) {
        throw new cw.DOMException(
          `DRM breakpoint canceled: ${_bpHit.id}`,
          "OperationError"
        );
      }
      const t0 = Date.now();
      actor._addEvent("createMediaKeys", "", `keySystem: ${ks}`, stack, {
        keySystem: ks,
      });
      return actor._originals.createMediaKeys.call(this).then(
        mediaKeys => {
          const durationMs = Date.now() - t0;
          actor._addEvent(
            "createMediaKeys-resolved",
            "",
            `keySystem: ${ks} (${durationMs}ms)`,
            null,
            { keySystem: ks, durationMs }
          );
          return mediaKeys;
        },
        err => {
          actor._addEvent(
            "createMediaKeys-error",
            "",
            `keySystem: ${ks}, ${err.name}: ${err.message}`,
            stack,
            { keySystem: ks, error: err.name, message: err.message }
          );
          throw err;
        }
      );
    };
  }

  _wrapSetMediaKeys(cw, actor) {
    if (!cw.HTMLMediaElement || !cw.HTMLMediaElement.prototype.setMediaKeys) {
      return;
    }
    this._originals.setMediaKeys = cw.HTMLMediaElement.prototype.setMediaKeys;
    cw.HTMLMediaElement.prototype.setMediaKeys = function (mediaKeys) {
      const stack = captureStack();
      const elInfo = getMediaElementInfo(this);
      const ks = mediaKeys
        ? Cu.waiveXrays(mediaKeys).keySystem || ""
        : "(null)";
      const _bpHit = actor._emitDrmCallSite(
        "setMediaKeys",
        {
          keySystem: ks,
          matchTarget: `${ks} ${elInfo?.src || ""}`,
          detail: `<${elInfo?.tagName || "?"}> keySystem: ${ks}, src: ${elInfo?.src || ""}`,
        },
        stack
      );
      if (_bpHit?.cancelOnHit) {
        throw new cw.DOMException(
          `DRM breakpoint canceled: ${_bpHit.id}`,
          "OperationError"
        );
      }
      actor._addEvent(
        "setMediaKeys",
        "",
        `<${elInfo?.tagName || "?"}> keySystem: ${ks}, src: ${elInfo?.src || ""}`,
        stack,
        { keySystem: ks, element: elInfo }
      );
      if (mediaKeys) {
        actor._trackedMediaElements.set(Cu.waiveXrays(mediaKeys), this);
      }
      return actor._originals.setMediaKeys.call(this, mediaKeys).then(
        () => {
          actor._addEvent(
            "setMediaKeys-resolved",
            "",
            `<${elInfo?.tagName || "?"}> MediaKeys attached`,
            null,
            { keySystem: ks }
          );
        },
        err => {
          actor._addEvent(
            "setMediaKeys-error",
            "",
            `${err.name}: ${err.message}`,
            stack,
            { error: err.name, message: err.message }
          );
          throw err;
        }
      );
    };
  }

  _wrapCreateSession(cw, actor) {
    if (!cw.MediaKeys || !cw.MediaKeys.prototype.createSession) {
      return;
    }
    this._originals.createSession = cw.MediaKeys.prototype.createSession;
    cw.MediaKeys.prototype.createSession = function (sessionType) {
      const stack = captureStack();
      const ks = Cu.waiveXrays(this).keySystem || "";
      const _bpHit = actor._emitDrmCallSite(
        "createSession",
        {
          keySystem: ks,
          matchTarget: `${ks} ${sessionType || "temporary"}`,
          detail: `Type: ${sessionType || "temporary"}, keySystem: ${ks}`,
        },
        stack
      );
      if (_bpHit?.cancelOnHit) {
        throw new cw.DOMException(
          `DRM breakpoint canceled: ${_bpHit.id}`,
          "OperationError"
        );
      }
      const session = actor._originals.createSession.call(
        this,
        sessionType || "temporary"
      );
      const el = actor._trackedMediaElements.get(Cu.waiveXrays(this));
      const elInfo = el ? getMediaElementInfo(el) : null;
      actor._trackSession(
        session,
        sessionType || "temporary",
        ks,
        stack,
        elInfo
      );
      return session;
    };
  }

  _wrapSetServerCertificate(cw, actor) {
    if (!cw.MediaKeys || !cw.MediaKeys.prototype.setServerCertificate) {
      return;
    }
    this._originals.setServerCertificate =
      cw.MediaKeys.prototype.setServerCertificate;
    cw.MediaKeys.prototype.setServerCertificate = function (cert) {
      const stack = captureStack();
      const size = cert ? cert.byteLength || cert.length || 0 : 0;
      const certHex = cert && size <= 512 ? bufferToHex(cert) : null;
      const ks = Cu.waiveXrays(this).keySystem || "";
      const _bpHit = actor._emitDrmCallSite(
        "setServerCertificate",
        {
          keySystem: ks,
          matchTarget: certHex || "",
          detail: `Certificate: ${size} bytes`,
        },
        stack
      );
      if (_bpHit?.cancelOnHit) {
        throw new cw.DOMException(
          `DRM breakpoint canceled: ${_bpHit.id}`,
          "OperationError"
        );
      }
      actor._addEvent(
        "setServerCertificate",
        "",
        `Certificate: ${size} bytes`,
        stack,
        { certSize: size, certHex }
      );
      return actor._originals.setServerCertificate.call(this, cert).then(
        result => {
          actor._addEvent(
            "setServerCertificate-resolved",
            "",
            `Result: ${result}`,
            null
          );
          return result;
        },
        err => {
          actor._addEvent(
            "setServerCertificate-error",
            "",
            `${err.name}: ${err.message}`,
            stack,
            { error: err.name, message: err.message }
          );
          throw err;
        }
      );
    };
  }

  _wrapGetStatusForPolicy(cw, actor) {
    if (!cw.MediaKeys || !cw.MediaKeys.prototype.getStatusForPolicy) {
      return;
    }
    this._originals.getStatusForPolicy =
      cw.MediaKeys.prototype.getStatusForPolicy;
    cw.MediaKeys.prototype.getStatusForPolicy = function (policy) {
      const stack = captureStack();
      const hdcpVersion = policy?.minHdcpVersion || "(none)";
      const ks = Cu.waiveXrays(this).keySystem || "";
      const _bpHit = actor._emitDrmCallSite(
        "getStatusForPolicy",
        {
          keySystem: ks,
          matchTarget: String(hdcpVersion),
          detail: `minHdcpVersion: ${hdcpVersion}`,
        },
        stack
      );
      if (_bpHit?.cancelOnHit) {
        throw new cw.DOMException(
          `DRM breakpoint canceled: ${_bpHit.id}`,
          "OperationError"
        );
      }
      actor._addEvent(
        "getStatusForPolicy",
        "",
        `minHdcpVersion: ${hdcpVersion}`,
        stack,
        { minHdcpVersion: hdcpVersion }
      );
      return actor._originals.getStatusForPolicy.call(this, policy).then(
        status => {
          actor._addEvent(
            "getStatusForPolicy-result",
            "",
            `HDCP ${hdcpVersion}: ${status}`,
            null,
            { minHdcpVersion: hdcpVersion, status }
          );
          return status;
        },
        err => {
          actor._addEvent(
            "getStatusForPolicy-error",
            "",
            `${err.name}: ${err.message}`,
            stack,
            { error: err.name, message: err.message }
          );
          throw err;
        }
      );
    };
  }

  _wrapGenerateRequest(cw, actor) {
    if (!cw.MediaKeySession || !cw.MediaKeySession.prototype.generateRequest) {
      return;
    }
    this._originals.generateRequest =
      cw.MediaKeySession.prototype.generateRequest;
    cw.MediaKeySession.prototype.generateRequest = function (
      initDataType,
      initData
    ) {
      const stack = captureStack();
      const sid = this.sessionId || `pending-${actor._trackedSessions.size}`;
      const dataHex = initData ? bufferToHex(initData) : "";
      const dataSize = initData ? initData.byteLength || 0 : 0;
      const _bpHit = actor._emitDrmCallSite(
        "generateRequest",
        {
          keySystem: actor._findSessionInfo(this)?.keySystem || "",
          sessionId: this.sessionId || sid,
          initDataType,
          initDataHex: dataHex,
          matchTarget: `${initDataType || ""} ${dataHex} ${this.sessionId || ""}`,
          detail: `initDataType: ${initDataType}, initData: ${dataSize} bytes`,
        },
        stack
      );
      if (_bpHit?.cancelOnHit) {
        throw new cw.DOMException(
          `DRM breakpoint canceled: ${_bpHit.id}`,
          "OperationError"
        );
      }
      const t0 = Date.now();

      let parsedInitData = null;
      if (initDataType === "cenc" && initData) {
        const psshBoxes = parsePsshBoxes(initData);
        if (psshBoxes.length) {
          parsedInitData = { type: "cenc", psshBoxes };
        }
      } else if (initDataType === "keyids" && initData) {
        const keyIds = parseKeyIdsInitData(initData);
        if (keyIds) {
          parsedInitData = { type: "keyids", content: keyIds };
        }
      } else if (initDataType === "webm" && initData) {
        parsedInitData = { type: "webm", keyIdHex: bufferToHex(initData) };
      }

      const info = actor._findSessionInfo(this);
      if (info) {
        info.initDataType = initDataType;
        info.initDataHex =
          dataHex.length > 2048 ? dataHex.substring(0, 2048) + "..." : dataHex;
        info.initDataSize = dataSize;
        info.parsedInitData = parsedInitData;
        info.generateRequestStack = stack;
        info.timeline.push({
          timestamp: Date.now(),
          action: "generateRequest",
          detail: `initDataType: ${initDataType}, size: ${dataSize} bytes`,
        });
      }

      actor._addEvent(
        "generateRequest",
        this.sessionId || sid,
        `initDataType: ${initDataType}, initData: ${dataSize} bytes`,
        stack,
        {
          initDataType,
          initDataSize: dataSize,
          initDataHex:
            dataHex.length > 512 ? dataHex.substring(0, 512) + "..." : dataHex,
          parsedInitData,
        }
      );

      return actor._originals.generateRequest
        .call(this, initDataType, initData)
        .then(
          result => {
            const durationMs = Date.now() - t0;
            if (info) {
              info.timeline.push({
                timestamp: Date.now(),
                action: "generateRequest-resolved",
                detail: `Session ID: ${this.sessionId} (${durationMs}ms)`,
              });
            }
            actor._addEvent(
              "generateRequest-resolved",
              this.sessionId || sid,
              `Session ID: ${this.sessionId} (${durationMs}ms)`,
              null,
              { durationMs }
            );
            actor._emitSessionsUpdated();
            return result;
          },
          err => {
            const durationMs = Date.now() - t0;
            if (info) {
              info.timeline.push({
                timestamp: Date.now(),
                action: "generateRequest-rejected",
                detail: `${err.name}: ${err.message} (${durationMs}ms)`,
              });
              info.errors.push({
                timestamp: Date.now(),
                type: "generateRequest",
                name: err.name,
                message: err.message,
                systemCode: err.systemCode || 0,
                stack,
              });
            }
            actor._addEvent(
              "generateRequest-error",
              this.sessionId || sid,
              `${err.name}: ${err.message} (${durationMs}ms)`,
              stack,
              { error: err.name, message: err.message, durationMs }
            );
            throw err;
          }
        );
    };
  }

  _wrapUpdate(cw, actor) {
    if (!cw.MediaKeySession || !cw.MediaKeySession.prototype.update) {
      return;
    }
    this._originals.update = cw.MediaKeySession.prototype.update;
    cw.MediaKeySession.prototype.update = function (response) {
      const stack = captureStack();
      const sid = this.sessionId || "unknown";
      const responseSize = response ? response.byteLength || 0 : 0;
      const responseB64 =
        response && responseSize <= 8192 ? bufferToBase64(response) : null;
      const responseHex =
        response && responseSize <= 512 ? bufferToHex(response) : null;
      const _bpHit = actor._emitDrmCallSite(
        "update",
        {
          keySystem: actor._findSessionInfo(this)?.keySystem || "",
          sessionId: sid,
          matchTarget: `${sid} ${responseHex || ""}`,
          detail: `Response: ${responseSize} bytes`,
        },
        stack
      );
      if (_bpHit?.cancelOnHit) {
        throw new cw.DOMException(
          `DRM breakpoint canceled: ${_bpHit.id}`,
          "OperationError"
        );
      }
      const t0 = Date.now();

      let parsedResponse = null;
      if (response) {
        const text = tryDecodeUtf8(response);
        if (text) {
          parsedResponse = tryParseJson(text);
        }
      }

      const info = actor._findSessionInfo(this);
      const exchange = {
        timestamp: Date.now(),
        responseSize,
        responseBase64: actor._captureRawData ? responseB64 : null,
        parsedResponse,
        durationMs: null,
        accepted: null,
        error: null,
      };

      if (info) {
        info.totalBytesReceived += responseSize;
        info.licenseExchanges.push(exchange);
        info.timeline.push({
          timestamp: Date.now(),
          action: "update",
          detail:
            `Response: ${responseSize} bytes` +
            (parsedResponse ? " (parsed as JSON)" : ""),
        });
      }

      actor._addEvent(
        "update",
        sid,
        `Response: ${responseSize} bytes` +
          (parsedResponse ? " (JSON)" : " (binary)"),
        stack,
        {
          responseSize,
          responseHex,
          responseBase64: actor._captureRawData ? responseB64 : null,
          parsedResponse,
        }
      );

      return actor._originals.update.call(this, response).then(
        () => {
          const durationMs = Date.now() - t0;
          exchange.durationMs = durationMs;
          exchange.accepted = true;
          if (info) {
            info.timeline.push({
              timestamp: Date.now(),
              action: "update-resolved",
              detail: `License accepted (${durationMs}ms)`,
            });
          }
          actor._addEvent(
            "update-resolved",
            sid,
            `License accepted (${durationMs}ms)`,
            null,
            { durationMs }
          );
          actor._emitSessionsUpdated();
        },
        err => {
          const durationMs = Date.now() - t0;
          exchange.durationMs = durationMs;
          exchange.accepted = false;
          exchange.error = { name: err.name, message: err.message };
          if (info) {
            info.timeline.push({
              timestamp: Date.now(),
              action: "update-rejected",
              detail: `${err.name}: ${err.message} (${durationMs}ms)`,
            });
            info.errors.push({
              timestamp: Date.now(),
              type: "update",
              name: err.name,
              message: err.message,
              systemCode: err.systemCode || 0,
              stack,
            });
          }
          actor._addEvent(
            "update-error",
            sid,
            `${err.name}: ${err.message} (${durationMs}ms)`,
            stack,
            { error: err.name, message: err.message, durationMs }
          );
          throw err;
        }
      );
    };
  }

  _wrapClose(cw, actor) {
    if (!cw.MediaKeySession || !cw.MediaKeySession.prototype.close) {
      return;
    }
    this._originals.close = cw.MediaKeySession.prototype.close;
    cw.MediaKeySession.prototype.close = function () {
      const stack = captureStack();
      const sid = this.sessionId || "unknown";
      const info = actor._findSessionInfo(this);
      const _bpHit = actor._emitDrmCallSite(
        "close",
        {
          keySystem: info?.keySystem || "",
          sessionId: sid,
          matchTarget: sid,
          detail: "Session close requested",
        },
        stack
      );
      if (_bpHit?.cancelOnHit) {
        throw new cw.DOMException(
          `DRM breakpoint canceled: ${_bpHit.id}`,
          "OperationError"
        );
      }
      if (info) {
        info.timeline.push({
          timestamp: Date.now(),
          action: "close-called",
          detail: "Application requested session close",
        });
      }
      actor._addEvent("close-called", sid, "Session close requested", stack);
      return actor._originals.close.call(this).then(
        () => {
          actor._addEvent(
            "close-resolved",
            sid,
            "Session close completed",
            null
          );
        },
        err => {
          actor._addEvent(
            "close-error",
            sid,
            `${err.name}: ${err.message}`,
            stack,
            { error: err.name, message: err.message }
          );
          throw err;
        }
      );
    };
  }

  _wrapRemove(cw, actor) {
    if (!cw.MediaKeySession || !cw.MediaKeySession.prototype.remove) {
      return;
    }
    this._originals.remove = cw.MediaKeySession.prototype.remove;
    cw.MediaKeySession.prototype.remove = function () {
      const stack = captureStack();
      const sid = this.sessionId || "unknown";
      const info = actor._findSessionInfo(this);
      const _bpHit = actor._emitDrmCallSite(
        "remove",
        {
          keySystem: info?.keySystem || "",
          sessionId: sid,
          matchTarget: sid,
          detail: "License removal requested",
        },
        stack
      );
      if (_bpHit?.cancelOnHit) {
        throw new cw.DOMException(
          `DRM breakpoint canceled: ${_bpHit.id}`,
          "OperationError"
        );
      }
      actor._addEvent("remove-called", sid, "License removal requested", stack);
      return actor._originals.remove.call(this).then(
        () => {
          actor._addEvent("remove-resolved", sid, "License removed", null);
          actor._emitSessionsUpdated();
        },
        err => {
          actor._addEvent(
            "remove-error",
            sid,
            `${err.name}: ${err.message}`,
            stack,
            { error: err.name, message: err.message }
          );
          throw err;
        }
      );
    };
  }

  startObserving() {
    if (this._observing) {
      return;
    }
    this._observing = true;
    const cw = this._contentWindow;
    if (!cw) {
      return;
    }

    const actor = this;

    const wrappers = [
      "_wrapRequestMediaKeySystemAccess",
      "_wrapCreateMediaKeys",
      "_wrapSetMediaKeys",
      "_wrapCreateSession",
      "_wrapSetServerCertificate",
      "_wrapGetStatusForPolicy",
      "_wrapGenerateRequest",
      "_wrapUpdate",
      "_wrapClose",
      "_wrapRemove",
    ];
    for (const method of wrappers) {
      try {
        this[method](cw, actor);
      } catch (e) {
        console.warn(`DRM actor: ${method}:`, e);
      }
    }

    this._scanExistingMedia();

    try {
      const win = this._window;
      this._mutationObserver = new win.MutationObserver(mutations => {
        for (const mutation of mutations) {
          for (const node of mutation.addedNodes) {
            if (node.nodeType === win.Node.ELEMENT_NODE) {
              this._checkElementForDRM(node);
              if (node.querySelectorAll) {
                for (const el of node.querySelectorAll("video, audio")) {
                  this._checkElementForDRM(el);
                }
              }
            }
          }
        }
      });
      this._mutationObserver.observe(win.document, {
        childList: true,
        subtree: true,
      });
    } catch {
      // Ignore
    }
  }

  stopObserving() {
    if (!this._observing) {
      return;
    }
    this._observing = false;

    const cw = this._contentWindow;
    if (cw) {
      const restoreList = [
        ["requestMediaKeySystemAccess", cw.navigator, "navigator"],
        [
          "createMediaKeys",
          cw.MediaKeySystemAccess?.prototype,
          "MediaKeySystemAccess.prototype",
        ],
        [
          "setMediaKeys",
          cw.HTMLMediaElement?.prototype,
          "HTMLMediaElement.prototype",
        ],
        ["createSession", cw.MediaKeys?.prototype, "MediaKeys.prototype"],
        [
          "setServerCertificate",
          cw.MediaKeys?.prototype,
          "MediaKeys.prototype",
        ],
        ["getStatusForPolicy", cw.MediaKeys?.prototype, "MediaKeys.prototype"],
        [
          "generateRequest",
          cw.MediaKeySession?.prototype,
          "MediaKeySession.prototype",
        ],
        ["update", cw.MediaKeySession?.prototype, "MediaKeySession.prototype"],
        ["close", cw.MediaKeySession?.prototype, "MediaKeySession.prototype"],
        ["remove", cw.MediaKeySession?.prototype, "MediaKeySession.prototype"],
      ];
      for (const [name, obj] of restoreList) {
        if (this._originals[name] && obj) {
          try {
            obj[name] = this._originals[name];
          } catch {
            // Ignore
          }
        }
      }
    }

    this._originals = {};
    if (this._mutationObserver) {
      this._mutationObserver.disconnect();
      this._mutationObserver = null;
    }
    this._trackedSessions.clear();
    this._trackedMediaElements.clear();
    this._accessConfigs.clear();
    this._eventLog = [];
    this._drmBreakpointHits = [];
    this._triggers = [];
  }

  _scanExistingMedia() {
    const win = this._window;
    if (!win || !win.document) {
      return;
    }
    for (const el of win.document.querySelectorAll("video, audio")) {
      this._checkElementForDRM(el);
    }
  }

  _checkElementForDRM(el) {
    const tagName = el.tagName?.toLowerCase();
    if (tagName !== "video" && tagName !== "audio") {
      return;
    }
    el.addEventListener(
      "encrypted",
      event => {
        const dataSize = event.initData ? event.initData.byteLength : 0;
        const dataHex = event.initData ? bufferToHex(event.initData) : "";
        let parsedInitData = null;
        if (event.initDataType === "cenc" && event.initData) {
          const boxes = parsePsshBoxes(event.initData);
          if (boxes.length) {
            parsedInitData = { type: "cenc", psshBoxes: boxes };
          }
        } else if (event.initDataType === "keyids" && event.initData) {
          parsedInitData = parseKeyIdsInitData(event.initData);
        }
        const elInfo = getMediaElementInfo(el);
        this._addEvent(
          "encrypted",
          "",
          `<${tagName}> initDataType: ${event.initDataType}, ${dataSize} bytes, src: ${elInfo?.src || ""}`,
          null,
          {
            element: elInfo,
            initDataType: event.initDataType,
            initDataSize: dataSize,
            initDataHex:
              dataHex.length > 512
                ? dataHex.substring(0, 512) + "..."
                : dataHex,
            parsedInitData,
          }
        );
      },
      { once: true }
    );
  }

  _findSessionInfo(session) {
    const unwrapped = Cu.waiveXrays(session);
    for (const [, info] of this._trackedSessions) {
      if (Cu.waiveXrays(info.session) === unwrapped) {
        return info;
      }
    }
    return null;
  }

  _trackSession(
    session,
    sessionType,
    keySystem,
    createdStack,
    mediaElementInfo
  ) {
    const checkSessionId = () => {
      const waived = Cu.waiveXrays(session);
      const sessionId =
        waived.sessionId || `pending-${this._trackedSessions.size}`;
      if (this._trackedSessions.has(sessionId)) {
        return;
      }

      const info = {
        session,
        sessionType,
        keySystem,
        closed: false,
        closedReason: null,
        createdStack,
        generateRequestStack: null,
        initDataType: null,
        initDataHex: null,
        initDataSize: 0,
        parsedInitData: null,
        messageCount: 0,
        lastMessageType: null,
        lastMessageSize: 0,
        errors: [],
        timeline: [
          {
            timestamp: Date.now(),
            action: "created",
            detail: `Type: ${sessionType}, Key system: ${keySystem}`,
          },
        ],
        licenseExchanges: [],
        keyStatusHistory: [],
        mediaElementInfo,
        serverCertificateSet: false,
        totalBytesReceived: 0,
        totalBytesSent: 0,
        createdAt: Date.now(),
        firstKeyUsableAt: null,
        closedAt: null,
      };
      this._trackedSessions.set(sessionId, info);

      this._addEvent(
        "session-created",
        sessionId,
        `Type: ${sessionType}, Key system: ${keySystem}`,
        createdStack,
        { sessionType, keySystem, mediaElementInfo }
      );

      // keystatuseschange
      session.addEventListener("keystatuseschange", () => {
        const keyStatuses = [];
        try {
          const w = Cu.waiveXrays(session);
          for (const [keyId, status] of w.keyStatuses) {
            keyStatuses.push({ keyId: bufferToHex(keyId), status });
          }
        } catch {
          // Ignore
        }

        // Compute diff from previous
        const prevStatuses = info.keyStatusHistory.length
          ? info.keyStatusHistory[info.keyStatusHistory.length - 1].statuses
          : [];
        const changes = [];
        for (const ks of keyStatuses) {
          const prev = prevStatuses.find(p => p.keyId === ks.keyId);
          if (!prev) {
            changes.push({ keyId: ks.keyId, from: "(new)", to: ks.status });
          } else if (prev.status !== ks.status) {
            changes.push({ keyId: ks.keyId, from: prev.status, to: ks.status });
          }
        }
        for (const prev of prevStatuses) {
          if (!keyStatuses.find(k => k.keyId === prev.keyId)) {
            changes.push({
              keyId: prev.keyId,
              from: prev.status,
              to: "(removed)",
            });
          }
        }

        info.keyStatusHistory.push({
          timestamp: Date.now(),
          statuses: keyStatuses,
          changes,
        });

        // Track time to first usable key
        if (
          !info.firstKeyUsableAt &&
          keyStatuses.some(k => k.status === "usable")
        ) {
          info.firstKeyUsableAt = Date.now();
        }

        const changeStr = changes.length
          ? " Changes: " +
            changes
              .map(c => `${c.keyId.substring(0, 8)}...: ${c.from} -> ${c.to}`)
              .join(", ")
          : "";

        info.timeline.push({
          timestamp: Date.now(),
          action: "keystatuseschange",
          detail: `${keyStatuses.length} key(s)${changeStr}`,
        });

        this._addEvent(
          "keystatuseschange",
          waived.sessionId || sessionId,
          `${keyStatuses.length} key(s)${changeStr}`,
          null,
          { keyStatuses, changes }
        );
        this._emitSessionsUpdated();
      });

      // message
      session.addEventListener("message", event => {
        const evt = Cu.waiveXrays(event);
        info.messageCount++;
        info.lastMessageType = evt.messageType;
        info.lastMessageSize = evt.message ? evt.message.byteLength : 0;
        info.totalBytesSent += info.lastMessageSize;

        const msgB64 =
          evt.message && evt.message.byteLength <= 8192
            ? bufferToBase64(evt.message)
            : null;

        // Try to parse ClearKey license request
        let parsedMessage = null;
        if (evt.message) {
          parsedMessage = parseClearKeyMessage(evt.message);
        }

        // Store in license exchange log
        info.licenseExchanges.push({
          timestamp: Date.now(),
          direction: "request",
          messageType: evt.messageType,
          messageSize: info.lastMessageSize,
          messageBase64: this._captureRawData ? msgB64 : null,
          parsedMessage,
        });

        info.timeline.push({
          timestamp: Date.now(),
          action: "message",
          detail:
            `Type: ${evt.messageType}, ${info.lastMessageSize} bytes` +
            (parsedMessage ? " (parsed as JSON)" : ""),
        });

        this._addEvent(
          "message",
          waived.sessionId || sessionId,
          `Type: ${evt.messageType}, ${info.lastMessageSize} bytes` +
            (parsedMessage ? " (JSON)" : " (binary)"),
          null,
          {
            messageType: evt.messageType,
            messageSize: info.lastMessageSize,
            messageBase64: this._captureRawData ? msgB64 : null,
            parsedMessage,
          }
        );
      });

      // closed
      waived.closed.then(reason => {
        info.closed = true;
        info.closedReason = String(reason);
        info.closedAt = Date.now();
        const lifetimeMs = info.closedAt - info.createdAt;
        info.timeline.push({
          timestamp: Date.now(),
          action: "closed",
          detail: `Reason: ${reason}, lifetime: ${lifetimeMs}ms`,
        });
        this._addEvent(
          "session-closed",
          waived.sessionId || sessionId,
          `Reason: ${reason}, lifetime: ${lifetimeMs}ms, messages: ${info.messageCount}, errors: ${info.errors.length}`,
          null,
          {
            reason: String(reason),
            lifetimeMs,
            totalMessages: info.messageCount,
            totalBytesSent: info.totalBytesSent,
            totalBytesReceived: info.totalBytesReceived,
            totalErrors: info.errors.length,
            timeToFirstKey: info.firstKeyUsableAt
              ? info.firstKeyUsableAt - info.createdAt
              : null,
          }
        );
        this._emitSessionsUpdated();
      });

      // Watch the associated media element for ended/pause
      const mediaEl = this._getMediaElementForSession(sessionId);
      if (mediaEl) {
        const mw = Cu.waiveXrays(mediaEl);
        const emitMediaEnded = reason => {
          this._addEvent(
            "media-ended",
            waived.sessionId || sessionId,
            `Media ${reason} at ${mw.currentTime?.toFixed(2)}s`,
            null,
            { reason, currentTime: mw.currentTime }
          );
          if (this.conn?.transport) {
            this.emit("media-ended", {
              sessionId: waived.sessionId || sessionId,
              reason,
              currentTime: mw.currentTime,
            });
          }
        };
        mediaEl.addEventListener("ended", () => emitMediaEnded("ended"), {
          once: true,
        });
      }
    };

    const waived = Cu.waiveXrays(session);
    if (waived.sessionId) {
      checkSessionId();
    } else {
      let attempts = 0;
      const win = this._window;
      const interval = win.setInterval(() => {
        attempts++;
        if (Cu.waiveXrays(session).sessionId || attempts > 20) {
          win.clearInterval(interval);
          checkSessionId();
        }
      }, 100);
    }
  }

  _addEvent(type, sessionId, detail, stack, extra) {
    const entry = {
      timestamp: Date.now(),
      type,
      sessionId,
      detail,
      stack: stack || null,
      extra: extra || null,
    };
    this._eventLog.push(entry);
    if (this.conn?.transport) {
      this.emit("drm-event", entry);
    }
  }

  _emitSessionsUpdated() {
    if (this.conn?.transport) {
      this.emit("sessions-updated", this.getActiveSessions());
    }
  }

  // ---- Triggers + breakpoints integration helper ----

  // Called by every EME wrapper. Records a trigger entry (if it's an
  // entry-point method) and checks DRM breakpoints. Returns the matched
  // breakpoint (if any) so the caller can throw on cancelOnHit.
  _emitDrmCallSite(method, ctx, stack) {
    this._recordTrigger(method, ctx, stack, ctx.detail);
    return this._handleDrmBreakpointHit(method, ctx, stack);
  }

  // ---- Triggers ("What triggered this DRM") ----

  _recordTrigger(method, ctx, stack, detail) {
    if (!DRM_TRIGGER_METHODS.has(method)) {
      return;
    }
    const trigger = {
      timestamp: Date.now(),
      method,
      keySystem: ctx.keySystem || "",
      sessionId: ctx.sessionId || null,
      initDataType: ctx.initDataType || null,
      initDataHex: ctx.initDataHex || null,
      detail: detail || "",
      stack: stack || null,
    };
    this._triggers.push(trigger);
    if (this._triggers.length > MAX_DRM_TRIGGERS) {
      this._triggers.splice(0, this._triggers.length - MAX_DRM_TRIGGERS);
    }
    if (this.conn?.transport) {
      this.emit("trigger-added", trigger);
    }
  }

  getTriggers() {
    return this._triggers.slice();
  }

  clearTriggers() {
    this._triggers = [];
    return { cleared: true };
  }

  // ---- Breakpoints ----

  _handleDrmBreakpointHit(method, ctx, stack) {
    if (!this._drmBreakpoints.length) {
      return null;
    }
    let matched = null;
    for (const bp of this._drmBreakpoints) {
      if (_drmBreakpointMatchesContext(bp, method, ctx)) {
        matched = bp;
        break;
      }
    }
    if (!matched) {
      return null;
    }
    matched.hits = (matched.hits || 0) + 1;
    matched.lastHit = Date.now();
    const hit = {
      bpId: matched.id,
      method,
      timestamp: matched.lastHit,
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
    };
    this._drmBreakpointHits.push(hit);
    if (this._drmBreakpointHits.length > MAX_DRM_BREAKPOINT_HITS) {
      this._drmBreakpointHits.splice(
        0,
        this._drmBreakpointHits.length - MAX_DRM_BREAKPOINT_HITS
      );
    }
    if (this.conn?.transport) {
      this.emit("breakpoint-hit", hit);
      this.emit("breakpoints-updated", this.listBreakpoints());
    }
    if (matched.pauseOnHit) {
      const thread = this._targetActor?.threadActor;
      if (thread?.pauseForDrmBreakpoint) {
        try {
          thread.pauseForDrmBreakpoint({
            method,
            breakpointId: matched.id,
          });
        } catch (e) {
          console.warn("DRM actor: pauseForDrmBreakpoint failed:", e);
        }
      }
    }
    return matched;
  }

  addBreakpoint(spec) {
    const bp = {
      id: `drm-bp-${++this._drmBreakpointIdCounter}`,
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
      return { error: `Invalid matchType: ${bp.matchType}` };
    }
    _compileDrmBreakpointPattern(bp);
    if (bp._compileError) {
      return { error: `Invalid ${bp.matchType} pattern: ${bp._compileError}` };
    }
    this._drmBreakpoints.push(bp);
    if (this.conn?.transport) {
      this.emit("breakpoints-updated", this.listBreakpoints());
    }
    return _serializeDrmBreakpoint(bp);
  }

  removeBreakpoint(id) {
    const before = this._drmBreakpoints.length;
    this._drmBreakpoints = this._drmBreakpoints.filter(b => b.id !== id);
    const removed = before - this._drmBreakpoints.length;
    if (removed && this.conn?.transport) {
      this.emit("breakpoints-updated", this.listBreakpoints());
    }
    return { removed };
  }

  updateBreakpoint(id, patch) {
    const bp = this._drmBreakpoints.find(b => b.id === id);
    if (!bp) {
      return { error: "Not found" };
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
      _compileDrmBreakpointPattern(bp);
    }
    if (this.conn?.transport) {
      this.emit("breakpoints-updated", this.listBreakpoints());
    }
    return _serializeDrmBreakpoint(bp);
  }

  listBreakpoints() {
    return this._drmBreakpoints.map(_serializeDrmBreakpoint);
  }

  clearBreakpoints() {
    this._drmBreakpoints = [];
    if (this.conn?.transport) {
      this.emit("breakpoints-updated", []);
    }
    return { cleared: true };
  }

  getBreakpointHits() {
    return this._drmBreakpointHits.slice();
  }

  clearBreakpointHits() {
    this._drmBreakpointHits = [];
    return { cleared: true };
  }
};
