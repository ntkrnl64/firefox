/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// DISCLAIMER: This file is part of an unofficial Firefox modification that adds
// DRM/EME debugging tools. It is NOT endorsed by or affiliated with Mozilla.
// The DRM media capture functionality bypasses content protection restrictions
// and is intended ONLY for developer debugging and testing purposes.
// Do NOT use in production or to circumvent digital rights management.

const lazy = {};

ChromeUtils.defineESModuleGetters(lazy, {
  DrmCapture: "chrome://remote/content/mcp/DrmCapture.sys.mjs",
});

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
  "media.eme.capture-allowed",
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

const CODEC_PROBES = [
  'video/mp4; codecs="avc1.42E01E"',
  'video/mp4; codecs="avc1.640028"',
  'video/mp4; codecs="hev1.1.6.L93.B0"',
  'video/mp4; codecs="av01.0.01M.08"',
  'video/webm; codecs="vp8"',
  'video/webm; codecs="vp9"',
  'video/webm; codecs="vp09.00.10.08"',
  'audio/mp4; codecs="mp4a.40.2"',
  'audio/mp4; codecs="ac-3"',
  'audio/mp4; codecs="ec-3"',
  'audio/webm; codecs="opus"',
  'audio/webm; codecs="vorbis"',
];

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
  return getActor().evaluateJS(expression);
}

function text(data) {
  return [
    {
      type: "text",
      text: typeof data === "string" ? data : JSON.stringify(data, null, 2),
    },
  ];
}

// ---- Tool handlers ----

async function drmKeySystems() {
  const probeScript = `
    (async () => {
      const keySystems = ${JSON.stringify(KEY_SYSTEMS)};
      const configs = [{
        initDataTypes: ["cenc", "keyids", "webm"],
        videoCapabilities: [
          { contentType: 'video/mp4; codecs="avc1.42E01E"' },
          { contentType: 'video/mp4; codecs="avc1.640028"' },
          { contentType: 'video/webm; codecs="vp9"' },
        ],
        audioCapabilities: [
          { contentType: 'audio/mp4; codecs="mp4a.40.2"' },
          { contentType: 'audio/webm; codecs="opus"' },
        ],
      }];
      const results = [];
      for (const ks of keySystems) {
        let available = false, resolvedConfig = null;
        try {
          const access = await navigator.requestMediaKeySystemAccess(ks.keySystem, configs);
          available = true;
          const cfg = access.getConfiguration();
          resolvedConfig = {
            initDataTypes: [...(cfg.initDataTypes || [])],
            sessionTypes: [...(cfg.sessionTypes || [])],
            distinctiveIdentifier: cfg.distinctiveIdentifier,
            persistentState: cfg.persistentState,
            videoCapabilities: [...(cfg.videoCapabilities || [])].map(c => ({
              contentType: c.contentType, robustness: c.robustness || "",
              encryptionScheme: c.encryptionScheme || null,
            })),
            audioCapabilities: [...(cfg.audioCapabilities || [])].map(c => ({
              contentType: c.contentType, robustness: c.robustness || "",
              encryptionScheme: c.encryptionScheme || null,
            })),
          };
        } catch {}
        results.push({
          keySystem: ks.keySystem, label: ks.label, available,
          hardwareDecryption: !!ks.hardwareDecryption, resolvedConfig,
        });
      }
      return JSON.stringify(results);
    })()
  `;
  return text(JSON.parse(await evalInContent(probeScript)));
}

async function drmSessions() {
  const script = `
    (() => {
      const results = [];
      document.querySelectorAll('video, audio').forEach((el, i) => {
        const info = {
          index: i, tagName: el.tagName.toLowerCase(),
          src: el.currentSrc || el.src || undefined,
          readyState: el.readyState, networkState: el.networkState,
          paused: el.paused, currentTime: el.currentTime,
          duration: isFinite(el.duration) ? el.duration : null,
          hasDrm: !!el.mediaKeys,
        };
        if (el.mediaKeys) {
          info.keySystem = el.mediaKeys.keySystem || "unknown";
        }
        if (el.getVideoPlaybackQuality) {
          const q = el.getVideoPlaybackQuality();
          info.playbackQuality = {
            totalVideoFrames: q.totalVideoFrames,
            droppedVideoFrames: q.droppedVideoFrames,
          };
        }
        results.push(info);
      });
      return JSON.stringify(results);
    })()
  `;
  return text(JSON.parse(await evalInContent(script)));
}

async function drmSessionsDeep() {
  const script = `
    (async () => {
      const results = [];
      for (const el of document.querySelectorAll('video, audio')) {
        if (!el.mediaKeys) continue;
        const info = {
          tagName: el.tagName.toLowerCase(),
          src: el.currentSrc || el.src || "",
          keySystem: el.mediaKeys.keySystem || "unknown",
          readyState: el.readyState,
          networkState: el.networkState,
          paused: el.paused, ended: el.ended,
          currentTime: el.currentTime,
          duration: isFinite(el.duration) ? el.duration : null,
          videoWidth: el.videoWidth || 0,
          videoHeight: el.videoHeight || 0,
          volume: el.volume, muted: el.muted,
          playbackRate: el.playbackRate,
          error: el.error ? { code: el.error.code, message: el.error.message } : null,
          buffered: [],
        };
        try {
          for (let i = 0; i < el.buffered.length; i++) {
            info.buffered.push({ start: el.buffered.start(i), end: el.buffered.end(i) });
          }
        } catch {}
        if (el.getVideoPlaybackQuality) {
          const q = el.getVideoPlaybackQuality();
          info.playbackQuality = {
            totalVideoFrames: q.totalVideoFrames,
            droppedVideoFrames: q.droppedVideoFrames,
          };
        }
        // Debug info (privileged)
        try {
          if (el.mozRequestDebugInfo) {
            const dbg = await el.mozRequestDebugInfo();
            info.debugInfo = {
              compositorDroppedFrames: dbg.compositorDroppedFrames,
              emeKeySystem: dbg.EMEInfo?.keySystem,
              emeSessions: dbg.EMEInfo?.sessionsInfo,
            };
            if (dbg.decoder) {
              info.decoder = {
                playState: dbg.decoder.PlayState,
                containerType: dbg.decoder.containerType,
                hasAudio: dbg.decoder.hasAudio,
                hasVideo: dbg.decoder.hasVideo,
                channels: dbg.decoder.channels,
                rate: dbg.decoder.rate,
              };
              if (dbg.decoder.reader) {
                info.decoder.reader = {
                  videoType: dbg.decoder.reader.videoType,
                  videoDecoderName: dbg.decoder.reader.videoDecoderName,
                  videoHardwareAccelerated: dbg.decoder.reader.videoHardwareAccelerated,
                  videoWidth: dbg.decoder.reader.videoWidth,
                  videoHeight: dbg.decoder.reader.videoHeight,
                  audioType: dbg.decoder.reader.audioType,
                  audioDecoderName: dbg.decoder.reader.audioDecoderName,
                };
                if (dbg.decoder.reader.videoState) {
                  info.decoder.reader.videoWaitingForKey = dbg.decoder.reader.videoState.waitingForKey;
                  info.decoder.reader.videoWaitingForData = dbg.decoder.reader.videoState.waitingForData;
                }
                if (dbg.decoder.reader.audioState) {
                  info.decoder.reader.audioWaitingForKey = dbg.decoder.reader.audioState.waitingForKey;
                  info.decoder.reader.audioWaitingForData = dbg.decoder.reader.audioState.waitingForData;
                }
                if (dbg.decoder.reader.frameStats) {
                  info.decoder.reader.frameStats = {
                    droppedDecoded: dbg.decoder.reader.frameStats.droppedDecodedFrames,
                    droppedSink: dbg.decoder.reader.frameStats.droppedSinkFrames,
                    droppedCompositor: dbg.decoder.reader.frameStats.droppedCompositorFrames,
                  };
                }
              }
              if (dbg.decoder.stateMachine) {
                info.decoder.stateMachine = {
                  state: dbg.decoder.stateMachine.state,
                  isPlaying: dbg.decoder.stateMachine.isPlaying,
                  totalBufferingTimeMs: dbg.decoder.stateMachine.totalBufferingTimeMs,
                };
              }
            }
          }
        } catch {}
        results.push(info);
      }
      return JSON.stringify(results);
    })()
  `;
  return text(JSON.parse(await evalInContent(script)));
}

async function drmConfig() {
  const config = [];
  for (const name of EME_PREFS) {
    let value,
      type = "boolean";
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
  return text(config);
}

async function drmSetConfig(args) {
  const { name, value } = args;
  if (!name) {
    throw new Error("name is required");
  }
  if (!EME_PREFS.includes(name)) {
    throw new Error(`Pref "${name}" is not in the allowed EME prefs list`);
  }
  if (typeof value === "boolean") {
    Services.prefs.setBoolPref(name, value);
  } else if (typeof value === "number") {
    Services.prefs.setIntPref(name, value);
  } else {
    Services.prefs.setCharPref(name, String(value));
  }
  return text(`Set ${name} = ${value}`);
}

async function drmDiagnose() {
  const diagnostics = [];

  // Check prefs
  const emeEnabled = Services.prefs.getBoolPref("media.eme.enabled", false);
  if (!emeEnabled) {
    diagnostics.push({
      severity: "error",
      message: "EME is disabled",
      fix: "Set media.eme.enabled = true",
    });
  }
  if (!Services.prefs.getBoolPref("media.gmp-widevinecdm.enabled", false)) {
    diagnostics.push({
      severity: "warning",
      message: "Widevine CDM disabled",
      fix: "Set media.gmp-widevinecdm.enabled = true",
    });
  }

  // Probe key systems
  try {
    const probeResult = await evalInContent(`
      (async () => {
        const results = [];
        const configs = [{
          initDataTypes: ["cenc"],
          videoCapabilities: [{ contentType: 'video/mp4; codecs="avc1.42E01E"' }],
          audioCapabilities: [{ contentType: 'audio/mp4; codecs="mp4a.40.2"' }],
        }];
        for (const ks of ["org.w3.clearkey", "com.widevine.alpha",
                          "com.microsoft.playready.recommendation"]) {
          try {
            await navigator.requestMediaKeySystemAccess(ks, configs);
            results.push({ keySystem: ks, available: true });
          } catch {
            results.push({ keySystem: ks, available: false });
          }
        }
        return JSON.stringify(results);
      })()
    `);
    for (const p of JSON.parse(probeResult)) {
      if (!p.available) {
        diagnostics.push({
          severity: "warning",
          message: `${p.keySystem} not available`,
          detail: "CDM may not be installed or not supported on this platform.",
        });
      }
    }
  } catch {
    /* Ignore */
  }

  // Check for DRM media element issues
  try {
    const mediaCheck = await evalInContent(`
      (() => {
        const issues = [];
        document.querySelectorAll('video, audio').forEach(el => {
          if (el.error) {
            issues.push({ src: el.currentSrc?.substring(0, 100), error: el.error.code, message: el.error.message });
          }
        });
        return JSON.stringify(issues);
      })()
    `);
    for (const issue of JSON.parse(mediaCheck)) {
      diagnostics.push({
        severity: "error",
        message: `Media error on ${issue.src}: code=${issue.error}`,
        detail: issue.message,
      });
    }
  } catch {
    /* Ignore */
  }

  if (diagnostics.length === 0) {
    diagnostics.push({ severity: "info", message: "No issues detected" });
  }
  return text(diagnostics);
}

async function drmCodecSupport() {
  const script = `
    (async () => {
      const results = [];
      const codecs = ${JSON.stringify(CODEC_PROBES)};
      for (const codec of codecs) {
        const result = { codec, canPlay: false, smooth: false, powerEfficient: false };
        try {
          const [type, params] = codec.split("; codecs=");
          const isVideo = type.startsWith("video/");
          const config = {
            type: "media-source",
            [isVideo ? "video" : "audio"]: {
              contentType: codec,
              [isVideo ? "width" : "channels"]: isVideo ? 1920 : 2,
              [isVideo ? "height" : "samplerate"]: isVideo ? 1080 : 48000,
              bitrate: isVideo ? 5000000 : 128000,
              ...(isVideo ? { framerate: 30 } : {}),
            },
          };
          const info = await navigator.mediaCapabilities.decodingInfo(config);
          result.canPlay = info.supported;
          result.smooth = info.smooth;
          result.powerEfficient = info.powerEfficient;
        } catch {}
        results.push(result);
      }
      return JSON.stringify(results);
    })()
  `;
  return text(JSON.parse(await evalInContent(script)));
}

async function drmHdcpProbe(args) {
  const versions = args?.versions || ["1.0", "1.4", "2.0", "2.2", "2.3"];
  const keySystem = args?.key_system || "org.w3.clearkey";
  const script = `
    (async () => {
      const results = [];
      try {
        const access = await navigator.requestMediaKeySystemAccess("${keySystem}", [{
          initDataTypes: ["cenc"],
          videoCapabilities: [{ contentType: 'video/mp4; codecs="avc1.42E01E"' }],
        }]);
        const mk = await access.createMediaKeys();
        for (const v of ${JSON.stringify(versions)}) {
          try {
            const status = await mk.getStatusForPolicy({ minHdcpVersion: v });
            results.push({ version: v, status });
          } catch (e) {
            results.push({ version: v, error: e.message });
          }
        }
      } catch (e) {
        results.push({ error: "Key system not available: " + e.message });
      }
      return JSON.stringify(results);
    })()
  `;
  return text(JSON.parse(await evalInContent(script)));
}

async function drmRobustnessProbe(args) {
  const keySystem = args?.key_system || "com.widevine.alpha";
  const robustnessLevels = args?.levels || [
    "SW_SECURE_CRYPTO",
    "SW_SECURE_DECODE",
    "HW_SECURE_CRYPTO",
    "HW_SECURE_DECODE",
    "HW_SECURE_ALL",
    "150",
    "2000",
    "3000",
  ];
  const script = `
    (async () => {
      const results = [];
      for (const r of ${JSON.stringify(robustnessLevels)}) {
        try {
          const access = await navigator.requestMediaKeySystemAccess("${keySystem}", [{
            initDataTypes: ["cenc"],
            videoCapabilities: [{ contentType: 'video/mp4; codecs="avc1.42E01E"', robustness: r }],
          }]);
          const cfg = access.getConfiguration();
          results.push({
            robustness: r, available: true,
            resolvedVideoRobustness: cfg.videoCapabilities?.[0]?.robustness || "",
          });
        } catch (e) {
          results.push({ robustness: r, available: false, error: e.message });
        }
      }
      return JSON.stringify(results);
    })()
  `;
  return text(JSON.parse(await evalInContent(script)));
}

async function drmDebugLog() {
  const script = `
    (async () => {
      const results = [];
      for (const el of document.querySelectorAll('video, audio')) {
        const entry = { tagName: el.tagName.toLowerCase(), src: (el.currentSrc || el.src || "").substring(0, 200) };
        try {
          if (el.mozRequestDebugLog) {
            entry.debugLog = await el.mozRequestDebugLog();
          }
        } catch (e) { entry.error = e.message; }
        results.push(entry);
      }
      return JSON.stringify(results);
    })()
  `;
  return text(JSON.parse(await evalInContent(script)));
}

async function drmDecoderInfo() {
  const script = `
    (async () => {
      const results = [];
      for (const el of document.querySelectorAll('video, audio')) {
        if (!el.mediaKeys && el.readyState < 2) continue;
        const entry = {
          tagName: el.tagName.toLowerCase(),
          src: (el.currentSrc || el.src || "").substring(0, 200),
        };
        try {
          if (el.mozRequestDebugInfo) {
            const dbg = await el.mozRequestDebugInfo();
            entry.compositorDroppedFrames = dbg.compositorDroppedFrames;
            if (dbg.decoder) {
              entry.decoder = {
                playState: dbg.decoder.PlayState,
                containerType: dbg.decoder.containerType,
                hasAudio: dbg.decoder.hasAudio,
                hasVideo: dbg.decoder.hasVideo,
                channels: dbg.decoder.channels,
                sampleRate: dbg.decoder.rate,
              };
              if (dbg.decoder.reader) {
                entry.reader = {
                  videoType: dbg.decoder.reader.videoType,
                  videoDecoderName: dbg.decoder.reader.videoDecoderName,
                  videoHardwareAccelerated: dbg.decoder.reader.videoHardwareAccelerated,
                  videoWidth: dbg.decoder.reader.videoWidth,
                  videoHeight: dbg.decoder.reader.videoHeight,
                  videoRate: dbg.decoder.reader.videoRate,
                  videoSamplesOutput: dbg.decoder.reader.videoNumSamplesOutputTotal,
                  videoSamplesSkipped: dbg.decoder.reader.videoNumSamplesSkippedTotal,
                  audioType: dbg.decoder.reader.audioType,
                  audioDecoderName: dbg.decoder.reader.audioDecoderName,
                  audioFramesDecoded: dbg.decoder.reader.audioFramesDecoded,
                  metadataTimeMs: dbg.decoder.reader.totalReadMetadataTimeMs,
                  waitingForVideoDataMs: dbg.decoder.reader.totalWaitingForVideoDataTimeMs,
                };
                if (dbg.decoder.reader.frameStats) {
                  entry.reader.frameStats = {
                    droppedDecoded: dbg.decoder.reader.frameStats.droppedDecodedFrames,
                    droppedSink: dbg.decoder.reader.frameStats.droppedSinkFrames,
                    droppedCompositor: dbg.decoder.reader.frameStats.droppedCompositorFrames,
                  };
                }
                entry.reader.videoWaitingForKey = dbg.decoder.reader.videoState?.waitingForKey ?? null;
                entry.reader.audioWaitingForKey = dbg.decoder.reader.audioState?.waitingForKey ?? null;
              }
              if (dbg.decoder.stateMachine) {
                entry.stateMachine = {
                  state: dbg.decoder.stateMachine.state,
                  isPlaying: dbg.decoder.stateMachine.isPlaying,
                  audioCompleted: dbg.decoder.stateMachine.audioCompleted,
                  videoCompleted: dbg.decoder.stateMachine.videoCompleted,
                  totalBufferingTimeMs: dbg.decoder.stateMachine.totalBufferingTimeMs,
                };
              }
            }
          }
        } catch (e) { entry.error = e.message; }
        results.push(entry);
      }
      return JSON.stringify(results);
    })()
  `;
  return text(JSON.parse(await evalInContent(script)));
}

async function drmFrameAnalysis() {
  const script = `
    (() => {
      const results = [];
      document.querySelectorAll('video').forEach((el, i) => {
        const entry = { index: i, src: (el.currentSrc || "").substring(0, 200) };
        if (el.getVideoPlaybackQuality) {
          const q = el.getVideoPlaybackQuality();
          entry.totalFrames = q.totalVideoFrames;
          entry.droppedFrames = q.droppedVideoFrames;
          entry.dropRate = q.totalVideoFrames > 0
            ? ((q.droppedVideoFrames / q.totalVideoFrames) * 100).toFixed(2) + "%"
            : "0%";
        }
        entry.videoWidth = el.videoWidth;
        entry.videoHeight = el.videoHeight;
        entry.currentTime = el.currentTime;
        entry.duration = isFinite(el.duration) ? el.duration : null;
        entry.paused = el.paused;
        entry.playbackRate = el.playbackRate;
        entry.readyState = el.readyState;
        results.push(entry);
      });
      return JSON.stringify(results);
    })()
  `;
  return text(JSON.parse(await evalInContent(script)));
}

async function drmMediaSourceInfo() {
  const script = `
    (async () => {
      const results = [];
      for (const el of document.querySelectorAll('video, audio')) {
        const entry = { tagName: el.tagName.toLowerCase() };
        try {
          const ms = el.mozMediaSourceObject;
          if (!ms) { entry.mediaSource = null; continue; }
          entry.mediaSource = {
            readyState: ms.readyState,
            duration: isFinite(ms.duration) ? ms.duration : null,
            sourceBufferCount: ms.sourceBuffers?.length || 0,
            activeSourceBufferCount: ms.activeSourceBuffers?.length || 0,
          };
          if (ms.mozDebugReaderData) {
            const dbg = await ms.mozDebugReaderData();
            if (dbg.demuxer) {
              entry.demuxer = {};
              if (dbg.demuxer.audioTrack) {
                entry.demuxer.audio = {
                  type: dbg.demuxer.audioTrack.type,
                  numSamples: dbg.demuxer.audioTrack.numSamples,
                  bufferSize: dbg.demuxer.audioTrack.bufferSize,
                  evictable: dbg.demuxer.audioTrack.evictable,
                };
              }
              if (dbg.demuxer.videoTrack) {
                entry.demuxer.video = {
                  type: dbg.demuxer.videoTrack.type,
                  numSamples: dbg.demuxer.videoTrack.numSamples,
                  bufferSize: dbg.demuxer.videoTrack.bufferSize,
                  evictable: dbg.demuxer.videoTrack.evictable,
                };
              }
            }
          }
        } catch (e) { entry.error = e.message; }
        results.push(entry);
      }
      return JSON.stringify(results);
    })()
  `;
  return text(JSON.parse(await evalInContent(script)));
}

async function drmKeyStatusMonitor(args) {
  const durationMs = args?.duration_ms || 10000;
  const intervalMs = args?.interval_ms || 500;
  const script = `
    (async () => {
      const snapshots = [];
      const startTime = Date.now();
      const elements = [...document.querySelectorAll('video, audio')].filter(e => e.mediaKeys);

      while (Date.now() - startTime < ${durationMs}) {
        const snapshot = { t: Date.now() - startTime, sessions: [] };
        for (const el of elements) {
          // We can't enumerate sessions directly, but we can track via events
          snapshot.sessions.push({
            keySystem: el.mediaKeys.keySystem,
            readyState: el.readyState,
            currentTime: el.currentTime,
            paused: el.paused,
          });
        }
        snapshots.push(snapshot);
        await new Promise(r => setTimeout(r, ${intervalMs}));
      }
      return JSON.stringify({
        durationMs: ${durationMs}, intervalMs: ${intervalMs},
        snapshots: snapshots.length, data: snapshots
      });
    })()
  `;
  return text(JSON.parse(await evalInContent(script)));
}

async function drmEvents(args) {
  const durationMs = args?.duration_ms || 5000;
  const script = `
    (async () => {
      const events = [];
      const mediaEls = document.querySelectorAll('video, audio');
      const listeners = [];
      for (const el of mediaEls) {
        if (!el.mediaKeys) continue;
        for (const evtName of ["encrypted", "waitingforkey", "play", "pause",
                                "seeking", "seeked", "ended", "error",
                                "stalled", "waiting", "canplay"]) {
          const handler = e => {
            events.push({
              timestamp: Date.now(), type: evtName,
              element: el.tagName.toLowerCase(),
              currentTime: el.currentTime,
              detail: evtName === "error" && el.error
                ? el.error.code + ": " + (el.error.message || "")
                : undefined,
            });
          };
          el.addEventListener(evtName, handler);
          listeners.push(() => el.removeEventListener(evtName, handler));
        }
      }
      await new Promise(r => setTimeout(r, ${durationMs}));
      for (const cleanup of listeners) cleanup();
      return JSON.stringify(events);
    })()
  `;
  return text(JSON.parse(await evalInContent(script)));
}

async function drmGmpStatus() {
  const gmpPrefs = [
    "media.gmp-widevinecdm.enabled",
    "media.gmp-widevinecdm.visible",
    "media.gmp-widevinecdm.autoupdate",
    "media.gmp-widevinecdm.version",
    "media.gmp-widevinecdm.lastDownload",
    "media.gmp-widevinecdm.lastInstallStart",
    "media.gmp-widevinecdm.lastUpdate",
    "media.gmp-widevinecdm.hashValue",
    "media.gmp-widevinecdm.abi",
    "media.gmp.decoder.enabled",
  ];
  const result = {};
  for (const pref of gmpPrefs) {
    try {
      try {
        result[pref] = Services.prefs.getBoolPref(pref);
        continue;
      } catch {}
      try {
        result[pref] = Services.prefs.getCharPref(pref);
        continue;
      } catch {}
      try {
        result[pref] = Services.prefs.getIntPref(pref);
        continue;
      } catch {}
      result[pref] = null;
    } catch {
      result[pref] = null;
    }
  }

  // GMP plugin directory
  try {
    const dominated = Services.dirsvc.get("ProfD", Ci.nsIFile);
    dominated.append("gmp-widevinecdm");
    result.gmpDirectory = dominated.path;
    result.gmpDirectoryExists = dominated.exists();
  } catch {
    /* Ignore */
  }

  return text(result);
}

async function drmFullReport() {
  const report = {
    timestamp: new Date().toISOString(),
    platform: {
      os: Services.appinfo.OS,
      platformVersion: Services.appinfo.platformVersion,
      appVersion: Services.appinfo.version,
      buildID: Services.appinfo.appBuildID,
    },
    prefs: {},
    keySystems: [],
    mediaElements: [],
    gmpStatus: {},
  };

  // Prefs
  for (const name of EME_PREFS) {
    const boolVal = Services.prefs.getBoolPref(name, undefined);
    if (boolVal !== undefined) {
      report.prefs[name] = boolVal;
      continue;
    }
    const charVal = Services.prefs.getCharPref(name, undefined);
    if (charVal !== undefined) {
      report.prefs[name] = charVal;
      continue;
    }
    report.prefs[name] = null;
  }

  // Key systems
  try {
    const ksResult = await drmKeySystems();
    report.keySystems = JSON.parse(ksResult[0].text);
  } catch {
    /* Ignore */
  }

  // Deep session info
  try {
    const sessResult = await drmSessionsDeep();
    report.mediaElements = JSON.parse(sessResult[0].text);
  } catch {
    /* Ignore */
  }

  // GMP
  try {
    const gmpResult = await drmGmpStatus();
    report.gmpStatus = JSON.parse(gmpResult[0].text);
  } catch {
    /* Ignore */
  }

  return text(report);
}

// ---- DRM trace + breakpoints (backed by DrmCapture) ----

async function ensureDrmInstalled() {
  // Inject the content-side wrapper. Idempotent — returns "already-installed"
  // if it was set up earlier in this content global. Page navigation drops
  // the global, so we re-install on every call.
  try {
    await evalInContent(lazy.DrmCapture.installerScript);
  } catch (e) {
    return { error: "Failed to install DRM wrappers: " + e.message };
  }
  // Sync the latest breakpoint list down.
  try {
    await evalInContent(lazy.DrmCapture.buildSyncScript());
  } catch (e) {
    return { error: "Failed to sync breakpoints: " + e.message };
  }
  return { ok: true };
}

async function drainContentDrmState() {
  let drained;
  try {
    drained = await evalInContent(lazy.DrmCapture.buildDrainScript());
  } catch {
    return;
  }
  lazy.DrmCapture.ingestDrained(drained);
}

async function drmWhatTriggered(args) {
  await ensureDrmInstalled();
  await drainContentDrmState();
  const triggers = lazy.DrmCapture.triggers;
  if (!triggers.length) {
    return text(
      "No DRM activity captured yet. Open a page that uses EME and try again."
    );
  }
  const which = args?.which || "first";
  const t = which === "last" ? triggers[triggers.length - 1] : triggers[0];
  const lines = [
    `${t.method}${t.keySystem ? ` (${t.keySystem})` : ""}`,
    `time: ${new Date(t.timestamp).toISOString()}`,
  ];
  if (t.sessionId) {
    lines.push(`sessionId: ${t.sessionId}`);
  }
  if (t.initDataType) {
    lines.push(
      `initDataType: ${t.initDataType}, initData: ${(t.initDataHex || "").slice(0, 64)}${t.initDataHex && t.initDataHex.length > 64 ? "…" : ""}`
    );
  }
  if (t.detail) {
    lines.push(`detail: ${t.detail}`);
  }
  lines.push("");
  if (t.stack) {
    lines.push("Stack:");
    lines.push(t.stack);
  } else {
    lines.push("(no JS stack — invocation came from native code)");
  }
  return text(lines.join("\n"));
}

async function drmTriggers(args) {
  await ensureDrmInstalled();
  await drainContentDrmState();
  const { count = 50, clear = false, format = "json" } = args || {};
  const triggers = lazy.DrmCapture.triggers.slice(-count);
  if (clear) {
    lazy.DrmCapture.clearTriggers();
  }
  if (format === "text") {
    return text(
      triggers
        .map(
          t =>
            `${new Date(t.timestamp).toISOString()}  ${t.method.padEnd(28)}  ${t.keySystem || "-"}  ${t.detail || ""}`
        )
        .join("\n") || "(no triggers)"
    );
  }
  return text(triggers);
}

async function drmSetBreakpoint(args) {
  let bp;
  try {
    bp = lazy.DrmCapture.addBreakpoint(args || {});
  } catch (e) {
    throw new Error(e.message);
  }
  await ensureDrmInstalled();
  return text(bp);
}

async function drmRemoveBreakpoint(args) {
  const removed = lazy.DrmCapture.removeBreakpoint(args?.id);
  await ensureDrmInstalled();
  if (args?.id === undefined) {
    return text(`Cleared all breakpoints (${removed} removed)`);
  }
  return text(removed ? `Removed breakpoint ${args.id}` : `No breakpoint with id ${args.id}`);
}

async function drmUpdateBreakpoint(args) {
  if (!args?.id) {
    throw new Error("id is required");
  }
  const bp = lazy.DrmCapture.updateBreakpoint(args.id, args.patch || {});
  if (!bp) {
    throw new Error(`No breakpoint with id ${args.id}`);
  }
  await ensureDrmInstalled();
  return text(bp);
}

async function drmListBreakpoints() {
  await drainContentDrmState();
  return text(lazy.DrmCapture.serializedBreakpoints);
}

async function drmBreakpointHits(args) {
  await ensureDrmInstalled();
  await drainContentDrmState();
  const { count = 50, clear = false, format = "json" } = args || {};
  const hits = lazy.DrmCapture.hits.slice(-count);
  if (clear) {
    lazy.DrmCapture.clearBreakpointHits();
  }
  if (format === "text") {
    return text(
      hits
        .map(
          h =>
            `${new Date(h.timestamp).toISOString()}  ${h.bpId}  ${h.method.padEnd(28)}  ${h.keySystem || "-"}  ${h.detail || ""}`
        )
        .join("\n") || "(no hits)"
    );
  }
  return text(hits);
}

// ---- Tool registry ----

export const DrmTools = {
  tools: [
    {
      name: "drm_key_systems",
      description:
        "Probe which DRM key systems (ClearKey, Widevine, PlayReady) are available, including resolved configurations with supported codecs, init data types, session types, and robustness",
      inputSchema: { type: "object", properties: {} },
      handler: drmKeySystems,
    },
    {
      name: "drm_sessions",
      description:
        "List all media elements on the page with their DRM session status, key system, and playback quality stats",
      inputSchema: { type: "object", properties: {} },
      handler: drmSessions,
    },
    {
      name: "drm_sessions_deep",
      description:
        "Deep inspection of DRM-enabled media: decoder pipeline (codec names, HW accel, frame stats, waitingForKey state), state machine, buffering stats, EME session info from mozRequestDebugInfo",
      inputSchema: { type: "object", properties: {} },
      handler: drmSessionsDeep,
    },
    {
      name: "drm_config",
      description:
        "Get all EME/DRM-related preferences including capture-allowed, GMP, WMF, and codec prefs",
      inputSchema: { type: "object", properties: {} },
      handler: drmConfig,
    },
    {
      name: "drm_set_config",
      description: "Set an EME preference value (must be in allowlist)",
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string", description: "Preference name" },
          value: { description: "New value" },
        },
        required: ["name", "value"],
      },
      handler: drmSetConfig,
    },
    {
      name: "drm_diagnose",
      description:
        "Run comprehensive DRM diagnostics: check prefs, probe key systems, detect media errors, suggest fixes",
      inputSchema: { type: "object", properties: {} },
      handler: drmDiagnose,
    },
    {
      name: "drm_codec_support",
      description:
        "Probe MediaCapabilities.decodingInfo() for all common DRM codecs (H.264, H.265, VP9, AV1, AAC, Opus, AC-3, E-AC-3) with smooth/powerEfficient flags",
      inputSchema: { type: "object", properties: {} },
      handler: drmCodecSupport,
    },
    {
      name: "drm_hdcp_probe",
      description:
        "Test HDCP policy compliance at various versions (1.0-2.3) via MediaKeys.getStatusForPolicy()",
      inputSchema: {
        type: "object",
        properties: {
          key_system: {
            type: "string",
            description: "Key system to test (default: org.w3.clearkey)",
          },
          versions: {
            type: "array",
            items: { type: "string" },
            description:
              "HDCP versions to probe (default: 1.0,1.4,2.0,2.2,2.3)",
          },
        },
      },
      handler: drmHdcpProbe,
    },
    {
      name: "drm_robustness_probe",
      description:
        "Test which robustness levels are supported for a key system (SW_SECURE_CRYPTO through HW_SECURE_ALL for Widevine, 150/2000/3000 for PlayReady)",
      inputSchema: {
        type: "object",
        properties: {
          key_system: {
            type: "string",
            description: "Key system (default: com.widevine.alpha)",
          },
          levels: {
            type: "array",
            items: { type: "string" },
            description: "Robustness levels to test",
          },
        },
      },
      handler: drmRobustnessProbe,
    },
    {
      name: "drm_debug_log",
      description:
        "Get the DecoderDoctor debug log for all media elements via mozRequestDebugLog() — detailed internal decoder/demuxer/CDM messages",
      inputSchema: { type: "object", properties: {} },
      handler: drmDebugLog,
    },
    {
      name: "drm_decoder_info",
      description:
        "Get full decoder pipeline info: codec names, HW acceleration, frame stats (dropped/decoded/skipped), waitingForKey state, buffering time, state machine state",
      inputSchema: { type: "object", properties: {} },
      handler: drmDecoderInfo,
    },
    {
      name: "drm_frame_analysis",
      description:
        "Analyze video frame delivery: total frames, dropped frames, drop rate percentage, resolution, playback rate — useful for detecting decryption performance issues",
      inputSchema: { type: "object", properties: {} },
      handler: drmFrameAnalysis,
    },
    {
      name: "drm_media_source_info",
      description:
        "Inspect MediaSource/SourceBuffer state: readyState, buffer counts, demuxer track info (sample counts, buffer sizes, evictable bytes) via mozDebugReaderData()",
      inputSchema: { type: "object", properties: {} },
      handler: drmMediaSourceInfo,
    },
    {
      name: "drm_key_status_monitor",
      description:
        "Monitor DRM media element state over time at configurable intervals — captures playback position, readyState, pause state for correlation with key events",
      inputSchema: {
        type: "object",
        properties: {
          duration_ms: {
            type: "integer",
            description: "Monitor duration in ms (default: 10000)",
          },
          interval_ms: {
            type: "integer",
            description: "Snapshot interval in ms (default: 500)",
          },
        },
      },
      handler: drmKeyStatusMonitor,
    },
    {
      name: "drm_events",
      description:
        "Capture media events (encrypted, waitingforkey, play, pause, seeking, ended, error, stalled, waiting, canplay) for a duration — correlates playback events with DRM state",
      inputSchema: {
        type: "object",
        properties: {
          duration_ms: {
            type: "integer",
            description: "Capture duration in ms (default: 5000)",
          },
        },
      },
      handler: drmEvents,
    },
    {
      name: "drm_gmp_status",
      description:
        "Get GMP (Gecko Media Plugin) status: Widevine CDM version, download/install timestamps, hash, ABI, plugin directory existence",
      inputSchema: { type: "object", properties: {} },
      handler: drmGmpStatus,
    },
    {
      name: "drm_full_report",
      description:
        "Generate a comprehensive DRM health report: platform info, all EME prefs, key system availability with configs, deep media element inspection, GMP status — suitable for bug reports",
      inputSchema: { type: "object", properties: {} },
      handler: drmFullReport,
    },
    {
      name: "drm_what_triggered",
      description:
        "Show the JS stack that triggered DRM activation on the active tab. Returns the first (default) or last EME entry-point invocation captured by the content-side wrappers, with its method, key system, session id, init data, and stack trace.",
      inputSchema: {
        type: "object",
        properties: {
          which: {
            type: "string",
            enum: ["first", "last"],
            description:
              "Which trigger to return — 'first' for the call that started DRM, 'last' for the most recent. Default: first.",
          },
        },
      },
      handler: drmWhatTriggered,
    },
    {
      name: "drm_triggers",
      description:
        "List EME entry-point invocations captured on the active tab (requestMediaKeySystemAccess, createMediaKeys, setMediaKeys, createSession, generateRequest, update, close, remove, setServerCertificate, getStatusForPolicy) with stacks. Drains content-side capture and merges into the parent registry.",
      inputSchema: {
        type: "object",
        properties: {
          count: {
            type: "integer",
            description: "Max triggers to return (default: 50)",
          },
          clear: {
            type: "boolean",
            description: "Clear stored triggers after returning",
          },
          format: {
            type: "string",
            enum: ["json", "text"],
            description: "Output format (default: json)",
          },
        },
      },
      handler: drmTriggers,
    },
    {
      name: "drm_set_breakpoint",
      description:
        "Register a DRM breakpoint. When a matching EME call happens on the active tab, its initiator stack is captured into drm_breakpoint_hits. Optionally cancels the call (cancelOnHit) or pauses execution at the call site (pauseOnHit, lands the JS debugger on the page). Pattern matching uses substring (default), wildcard (* and ?), or regex against a per-method match target (init data hex / sessionId / src / etc).",
      inputSchema: {
        type: "object",
        properties: {
          method: {
            type: "string",
            description:
              "EME method to match: ANY (default) | requestMediaKeySystemAccess | createMediaKeys | setMediaKeys | createSession | generateRequest | update | close | remove | setServerCertificate | getStatusForPolicy",
          },
          keySystem: {
            type: "string",
            description:
              "Substring match against the key system (e.g. 'widevine', 'playready', 'clearkey').",
          },
          initDataType: {
            type: "string",
            enum: ["cenc", "keyids", "webm"],
            description: "Exact match on initDataType (only for generateRequest).",
          },
          pattern: {
            type: "string",
            description:
              "Pattern matched against the per-method target: init data hex (generateRequest), response hex (update), session id (close/remove), src URL (setMediaKeys), HDCP version (getStatusForPolicy), etc.",
          },
          matchType: {
            type: "string",
            enum: ["substring", "wildcard", "regex"],
            description: "How to interpret pattern. Default: substring.",
          },
          cancelOnHit: {
            type: "boolean",
            description:
              "If true, throw an OperationError DOMException to abort the matching call. Default: false.",
          },
          pauseOnHit: {
            type: "boolean",
            description:
              "If true, hit a `debugger` statement at the call site so the JS debugger pauses the page. Default: false.",
          },
        },
      },
      handler: drmSetBreakpoint,
    },
    {
      name: "drm_remove_breakpoint",
      description:
        "Remove a DRM breakpoint by id. Omit id to clear all DRM breakpoints.",
      inputSchema: {
        type: "object",
        properties: {
          id: {
            type: "string",
            description:
              "Breakpoint id returned by drm_set_breakpoint (omit to clear all).",
          },
        },
      },
      handler: drmRemoveBreakpoint,
    },
    {
      name: "drm_update_breakpoint",
      description:
        "Update one or more fields of an existing DRM breakpoint (toggle enabled, change cancelOnHit/pauseOnHit, edit pattern, etc).",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string" },
          patch: {
            type: "object",
            description:
              "Partial update — any of method/keySystem/initDataType/pattern/matchType/cancelOnHit/pauseOnHit/enabled.",
          },
        },
        required: ["id", "patch"],
      },
      handler: drmUpdateBreakpoint,
    },
    {
      name: "drm_list_breakpoints",
      description:
        "List all registered DRM breakpoints with hit counts and last-hit timestamps.",
      inputSchema: { type: "object", properties: {} },
      handler: drmListBreakpoints,
    },
    {
      name: "drm_breakpoint_hits",
      description:
        "Drain and return DRM breakpoint hits captured on the active tab. Each hit has the matched breakpoint id, method, key system, session id, init data, detail, and JS stack at the call site.",
      inputSchema: {
        type: "object",
        properties: {
          count: {
            type: "integer",
            description: "Max hits to return (default: 50)",
          },
          clear: {
            type: "boolean",
            description: "Clear stored hits after returning",
          },
          format: {
            type: "string",
            enum: ["json", "text"],
            description: "Output format (default: json)",
          },
        },
      },
      handler: drmBreakpointHits,
    },
  ],
};
