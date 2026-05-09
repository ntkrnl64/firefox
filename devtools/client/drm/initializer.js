/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// DISCLAIMER: This file is part of an unofficial Firefox modification that adds
// DRM/EME debugging tools. It is NOT endorsed by or affiliated with Mozilla.
// The DRM media capture functionality bypasses content protection restrictions
// and is intended ONLY for developer debugging and testing purposes.
// Do NOT use in production or to circumvent digital rights management.

"use strict";

const { BrowserLoader } = ChromeUtils.importESModule(
  "resource://devtools/shared/loader/browser-loader.sys.mjs"
);
const require = BrowserLoader({
  baseURI: "resource://devtools/client/drm/",
  window,
}).require;

const {
  createFactory,
} = require("resource://devtools/client/shared/vendor/react.mjs");
const {
  render,
  unmountComponentAtNode,
} = require("resource://devtools/client/shared/vendor/react-dom.mjs");
const Provider = createFactory(
  require("resource://devtools/client/shared/vendor/react-redux.js").Provider
);
const {
  bindActionCreators,
} = require("resource://devtools/client/shared/vendor/redux.js");
const {
  START_IGNORE_ACTION,
} = require("resource://devtools/client/shared/redux/middleware/ignore.js");

const {
  configureStore,
} = require("resource://devtools/client/drm/src/create-store.js");
const actions = require("resource://devtools/client/drm/src/actions/index.js");

const App = createFactory(
  require("resource://devtools/client/drm/src/components/App.js")
);

window.DrmApp = {
  async bootstrap({ toolbox, commands }) {
    this.toolbox = toolbox;
    this._commands = commands;
    this._destroyed = false;

    this.store = configureStore();
    this.actions = bindActionCreators(actions, this.store.dispatch);

    this._onTargetAvailable = this._onTargetAvailable.bind(this);
    this._onDrmEvent = this._onDrmEvent.bind(this);
    this._onSessionsUpdated = this._onSessionsUpdated.bind(this);
    this._onMediaEnded = this._onMediaEnded.bind(this);
    this._onTriggerAdded = this._onTriggerAdded.bind(this);
    this._onBreakpointHit = this._onBreakpointHit.bind(this);
    this._onBreakpointsUpdated = this._onBreakpointsUpdated.bind(this);

    await this._commands.targetCommand.watchTargets({
      types: [this._commands.targetCommand.TYPES.FRAME],
      onAvailable: this._onTargetAvailable,
    });

    this.mount = document.querySelector("#mount");
    const app = App({ commands });
    render(Provider({ store: this.store }, app), this.mount);
  },

  async _onTargetAvailable({ targetFront }) {
    if (!targetFront.isTopLevel || this._destroyed) {
      return;
    }

    // Clean up old front if any
    if (this._drmFront) {
      this._drmFront.off("drm-event", this._onDrmEvent);
      this._drmFront.off("sessions-updated", this._onSessionsUpdated);
      this._drmFront.off("media-ended", this._onMediaEnded);
      this._drmFront.off("trigger-added", this._onTriggerAdded);
      this._drmFront.off("breakpoint-hit", this._onBreakpointHit);
      this._drmFront.off("breakpoints-updated", this._onBreakpointsUpdated);
      try {
        await this._drmFront.stopObserving();
      } catch {
        // Old front may already be destroyed
      }
      this._drmFront = null;
    }

    try {
      const front = await targetFront.getFront("drm");
      if (this._destroyed) {
        return;
      }
      this._drmFront = front;
      await this._drmFront.startObserving();

      this._drmFront.on("drm-event", this._onDrmEvent);
      this._drmFront.on("sessions-updated", this._onSessionsUpdated);
      this._drmFront.on("media-ended", this._onMediaEnded);
      this._drmFront.on("trigger-added", this._onTriggerAdded);
      this._drmFront.on("breakpoint-hit", this._onBreakpointHit);
      this._drmFront.on("breakpoints-updated", this._onBreakpointsUpdated);

      await this._fetchAll();
    } catch (e) {
      console.warn("DRM panel: failed to connect to actor:", e);
    }
  },

  async _fetchAll() {
    if (this._destroyed || !this._drmFront) {
      return;
    }

    // Fetch independently so one failure doesn't block the rest
    try {
      const keySystems = await this._drmFront.getKeySystemAvailability();
      if (!this._destroyed) {
        this.actions.updateKeySystems(keySystems);
      }
    } catch {
      // Ignore
    }

    try {
      const sessions = await this._drmFront.getActiveSessions();
      if (!this._destroyed) {
        this.actions.updateSessions(sessions);
      }
    } catch {
      // Ignore
    }

    try {
      const config = await this._drmFront.getEMEConfig();
      if (!this._destroyed) {
        this.actions.updateConfig(config);
      }
    } catch {
      // Ignore
    }

    try {
      const diagnostics = await this._drmFront.getDiagnostics();
      if (!this._destroyed) {
        this.actions.updateDiagnostics(diagnostics);
      }
    } catch {
      // Ignore
    }

    try {
      const triggers = await this._drmFront.getTriggers();
      if (!this._destroyed) {
        this.actions.updateTriggers(triggers);
      }
    } catch {
      // Ignore
    }

    try {
      const breakpoints = await this._drmFront.listBreakpoints();
      if (!this._destroyed) {
        this.actions.updateBreakpoints(breakpoints);
      }
    } catch {
      // Ignore
    }

    try {
      const hits = await this._drmFront.getBreakpointHits();
      if (!this._destroyed) {
        this.actions.updateBreakpointHits(hits);
      }
    } catch {
      // Ignore
    }
  },

  _onDrmEvent(entry) {
    if (!this._destroyed) {
      this.actions.addDrmEvent(entry);
    }
  },

  _onTriggerAdded(trigger) {
    if (this._destroyed) {
      return;
    }
    // Re-fetch the full list — it's small and keeps order canonical.
    if (this._drmFront) {
      this._drmFront
        .getTriggers()
        .then(t => {
          if (!this._destroyed) {
            this.actions.updateTriggers(t);
          }
        })
        .catch(() => {});
    }
  },

  _onBreakpointHit(hit) {
    if (!this._destroyed) {
      this.actions.addBreakpointHit(hit);
    }
  },

  _onBreakpointsUpdated(breakpoints) {
    if (!this._destroyed) {
      this.actions.updateBreakpoints(breakpoints);
    }
  },

  async addDrmBreakpoint(spec) {
    if (!this._drmFront) {
      throw new Error("DRM front not connected");
    }
    const result = await this._drmFront.addBreakpoint(spec);
    if (result?.error) {
      throw new Error(result.error);
    }
    const breakpoints = await this._drmFront.listBreakpoints();
    if (!this._destroyed) {
      this.actions.updateBreakpoints(breakpoints);
    }
    return result;
  },

  async removeDrmBreakpoint(id) {
    if (!this._drmFront) {
      return;
    }
    await this._drmFront.removeBreakpoint(id);
    const breakpoints = await this._drmFront.listBreakpoints();
    if (!this._destroyed) {
      this.actions.updateBreakpoints(breakpoints);
    }
  },

  async updateDrmBreakpoint(id, patch) {
    if (!this._drmFront) {
      return;
    }
    await this._drmFront.updateBreakpoint(id, patch);
    const breakpoints = await this._drmFront.listBreakpoints();
    if (!this._destroyed) {
      this.actions.updateBreakpoints(breakpoints);
    }
  },

  _onSessionsUpdated(sessions) {
    if (!this._destroyed) {
      this.actions.updateSessions(sessions);
      this._onAutoRecordSessionsUpdated();
      // Auto-stop recording for any closed sessions
      this._autoStopClosedSessions(sessions);
    }
  },

  _onMediaEnded(data) {
    if (this._destroyed) {
      return;
    }
    const sid = data.sessionId;
    console.log("DRM auto-record: media ended for session " + sid);
    this._autoStopSession(sid, "media-ended");
  },

  async _autoStopSession(sessionId, reason) {
    // Cancel the fixed-duration timer if any
    const timerKey = sessionId + "_stream";
    if (this._autoRecordTimers.has(timerKey)) {
      clearTimeout(this._autoRecordTimers.get(timerKey));
      this._autoRecordTimers.delete(timerKey);
    }
    // Stop the recording and save
    try {
      const stopped = await this.stopStreamRecording(sessionId);
      if (stopped.dataUrl) {
        let ext = "webm";
        if (stopped.mimeType?.includes("ogg")) {
          ext = "ogg";
        } else if (stopped.mimeType?.includes("mp4")) {
          ext = "mp4";
        }
        await this._autoSaveDataUrl(
          stopped.dataUrl,
          sessionId,
          "recording",
          ext
        );
        console.log(
          "DRM auto-record: saved recording for session " +
            sessionId +
            " (stopped by: " +
            reason +
            ")"
        );
      }
    } catch {
      // Already stopped or no recording
    }
    // Also stop frame capture
    const frameKey = sessionId + "_frame";
    if (this._autoRecordTimers.has(frameKey)) {
      clearTimeout(this._autoRecordTimers.get(frameKey));
      this._autoRecordTimers.delete(frameKey);
    }
  },

  _autoStopClosedSessions(sessions) {
    for (const session of sessions) {
      if (
        session.closed &&
        this._autoRecordSeenSessions.has(session.sessionId)
      ) {
        this._autoStopSession(session.sessionId, "session-closed");
        this._autoRecordSeenSessions.delete(session.sessionId);
      }
    }
  },

  async refreshData() {
    await this._fetchAll();
  },

  async toggleRawDataCapture(enabled) {
    if (this._drmFront) {
      // The actor stores _captureRawData; we set it directly since
      // there is no dedicated RDP method — the flag is checked when
      // wrapping update/message handlers.
      // For now we just track it client-side and refetch.
      this._captureRawData = !!enabled;
    }
  },

  async captureVideoFrame(sessionId) {
    if (!this._drmFront) {
      return { error: "Not connected" };
    }
    this._enableEmeCapture();
    await this._waitForPrefSync();
    try {
      return await this._drmFront.captureVideoFrame(sessionId);
    } finally {
      this._disableEmeCapture();
    }
  },

  async getSessionMediaState(sessionId) {
    if (!this._drmFront) {
      return { error: "Not connected" };
    }
    return this._drmFront.getSessionMediaState(sessionId);
  },

  async getSessionDeepDebug(sessionId) {
    if (!this._drmFront) {
      return { error: "Not connected" };
    }
    return this._drmFront.getSessionDeepDebug(sessionId);
  },

  _emeCaptureRefCount: 0,

  _enableEmeCapture() {
    this._emeCaptureRefCount++;
    if (this._emeCaptureRefCount === 1) {
      try {
        Services.prefs.setBoolPref("media.eme.capture-allowed", true);
        console.log(
          "DRM panel: set media.eme.capture-allowed = true (read-back: " +
            Services.prefs.getBoolPref("media.eme.capture-allowed", false) +
            ")"
        );
      } catch (e) {
        console.warn("DRM panel: failed to set capture pref:", e);
      }
    }
  },

  _disableEmeCapture() {
    this._emeCaptureRefCount = Math.max(0, this._emeCaptureRefCount - 1);
    if (this._emeCaptureRefCount === 0) {
      try {
        Services.prefs.setBoolPref("media.eme.capture-allowed", false);
      } catch {
        // Ignore
      }
    }
  },

  // Wait for a pref change to propagate to content processes via IPC.
  // The pref service sends an IPC message to child processes; we need
  // to give it enough time to arrive before the actor reads it.
  _waitForPrefSync() {
    return new Promise(resolve => setTimeout(resolve, 200));
  },

  async startStreamRecording(sessionId) {
    if (!this._drmFront) {
      return { error: "Not connected" };
    }
    this._enableEmeCapture();
    // Let the pref IPC propagate to the content process before calling
    // captureStream() in the actor.
    await this._waitForPrefSync();
    const result = await this._drmFront.startStreamRecording(sessionId);
    if (result.error) {
      this._disableEmeCapture();
    }
    return result;
  },

  async stopStreamRecording(sessionId) {
    if (!this._drmFront) {
      return { error: "Not connected" };
    }
    const result = await this._drmFront.stopStreamRecording(sessionId);
    this._disableEmeCapture();
    return result;
  },

  async saveDataUrlToFile(dataUrl, defaultName) {
    const fp = Cc["@mozilla.org/filepicker;1"].createInstance(Ci.nsIFilePicker);
    const parentWin = Services.wm.getMostRecentBrowserWindow();
    fp.init(
      parentWin.browsingContext,
      "Save Exported Media",
      Ci.nsIFilePicker.modeSave
    );
    fp.defaultString = defaultName;
    const ext = defaultName.split(".").pop();
    fp.defaultExtension = ext;
    if (ext === "png") {
      fp.appendFilter("PNG Images", "*.png");
    } else if (ext === "webm") {
      fp.appendFilter("WebM Video", "*.webm");
    }
    fp.appendFilters(Ci.nsIFilePicker.filterAll);
    const rv = await new Promise(resolve => fp.open(resolve));
    if (
      rv !== Ci.nsIFilePicker.returnOK &&
      rv !== Ci.nsIFilePicker.returnReplace
    ) {
      return;
    }
    // Decode data URL to bytes
    const base64 = dataUrl.split(",")[1];
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    await IOUtils.write(fp.file.path, bytes);
  },

  getExportData() {
    const state = this.store.getState();
    return {
      exportedAt: new Date().toISOString(),
      keySystems: state.keySystems.list,
      sessions: state.sessions.list,
      eventLog: state.eventLog.entries,
      config: state.config.list,
      diagnostics: state.diagnostics.list,
    };
  },

  exportToClipboard() {
    const data = this.getExportData();
    const json = JSON.stringify(data, null, 2);
    const clipboardHelper = Cc[
      "@mozilla.org/widget/clipboardhelper;1"
    ].getService(Ci.nsIClipboardHelper);
    clipboardHelper.copyString(json);
  },

  async exportToFile() {
    const data = this.getExportData();
    const json = JSON.stringify(data, null, 2);

    const fp = Cc["@mozilla.org/filepicker;1"].createInstance(Ci.nsIFilePicker);
    const parentWin = Services.wm.getMostRecentBrowserWindow();
    fp.init(
      parentWin.browsingContext,
      "Export DRM Logs",
      Ci.nsIFilePicker.modeSave
    );
    fp.defaultString =
      "drm-debug-" + new Date().toISOString().replace(/[:.]/g, "-") + ".json";
    fp.defaultExtension = "json";
    fp.appendFilter("JSON Files", "*.json");
    fp.appendFilters(Ci.nsIFilePicker.filterAll);

    const rv = await new Promise(resolve => fp.open(resolve));
    if (
      rv !== Ci.nsIFilePicker.returnOK &&
      rv !== Ci.nsIFilePicker.returnReplace
    ) {
      return;
    }

    const encoder = new TextEncoder();
    const bytes = encoder.encode(json);
    await IOUtils.write(fp.file.path, bytes);
  },

  // ---- Auto-record engine ----

  _autoRecordSeenSessions: new Set(),
  _autoRecordTimers: new Map(),

  _getAutoRecordSettings() {
    return this.store.getState().autorecord;
  },

  _formatFilename(template, vars) {
    let name = template;
    for (const [k, v] of Object.entries(vars)) {
      name = name.split("{" + k + "}").join(v);
    }
    // Sanitize for filesystem
    return name.replace(/[<>:"/\\|?*]+/g, "_");
  },

  _buildFileVars(sessionId, type) {
    const now = new Date();
    let hostname = "";
    try {
      hostname = new URL(this._commands.targetCommand.targetFront.url).hostname;
    } catch {
      hostname = "unknown";
    }
    const session = this.store
      .getState()
      .sessions.list.find(s => s.sessionId === sessionId);
    return {
      sessionId: sessionId || "unknown",
      keySystem: (session?.keySystem || "unknown").replace(/\./g, "_"),
      date: now.toISOString().substring(0, 10),
      time: now.toTimeString().substring(0, 8).replace(/:/g, "-"),
      timestamp: String(Date.now()),
      hostname,
      type,
    };
  },

  _buildOutputPath(settings, filename) {
    // Use PathUtils.join for platform-correct separators
    try {
      return PathUtils.join(settings.outputDir, filename);
    } catch {
      // Fallback: normalize slashes to OS separator
      const sep = Services.appinfo.OS === "WINNT" ? "\\" : "/";
      const dir = settings.outputDir.replace(/[/\\]+$/, "");
      return dir + sep + filename;
    }
  },

  async _autoSaveDataUrl(dataUrl, sessionId, type, ext) {
    const settings = this._getAutoRecordSettings();
    if (!settings.outputDir) {
      return;
    }
    const vars = this._buildFileVars(sessionId, type);
    const filename =
      this._formatFilename(settings.filenameTemplate, vars) + "." + ext;
    const fullPath = this._buildOutputPath(settings, filename);
    try {
      const base64 = dataUrl.split(",")[1];
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      await IOUtils.write(fullPath, bytes);
      console.log("DRM auto-record: saved " + fullPath);
    } catch (e) {
      console.warn("DRM auto-record: failed to save " + fullPath, e);
    }
  },

  async _autoSaveJson(data, sessionId, type) {
    const settings = this._getAutoRecordSettings();
    if (!settings.outputDir) {
      return;
    }
    const vars = this._buildFileVars(sessionId, type);
    const filename =
      this._formatFilename(settings.filenameTemplate, vars) + ".json";
    const fullPath = this._buildOutputPath(settings, filename);
    try {
      const bytes = new TextEncoder().encode(JSON.stringify(data, null, 2));
      await IOUtils.write(fullPath, bytes);
      console.log("DRM auto-record: saved " + fullPath);
    } catch (e) {
      console.warn("DRM auto-record: failed to save " + fullPath, e);
    }
  },

  _onAutoRecordSessionsUpdated() {
    const settings = this._getAutoRecordSettings();
    if (!settings.enabled || !settings.outputDir || !this._drmFront) {
      return;
    }

    const sessions = this.store.getState().sessions.list;
    for (const session of sessions) {
      if (
        session.closed ||
        this._autoRecordSeenSessions.has(session.sessionId)
      ) {
        continue;
      }
      // Only trigger on sessions that have at least one usable key
      const hasUsableKey = session.keyStatuses?.some(
        k => k.status === "usable"
      );
      if (!hasUsableKey) {
        continue;
      }

      this._autoRecordSeenSessions.add(session.sessionId);
      const sid = session.sessionId;

      // Auto-record stream — attempt for any session; the actor will
      // return an error for <audio>-only elements which we skip silently.
      if (settings.autoRecordStreams) {
        this._startAutoRecordStream(sid, settings.maxRecordingDurationSec);
      }

      // Auto-capture frames
      if (settings.autoRecordFrames) {
        this._startAutoRecordFrames(sid, settings.frameIntervalSec);
      }

      // Auto-export session logs
      if (settings.autoExportLogs) {
        // Export after a short delay to let the session stabilize
        setTimeout(() => this._autoExportSessionLog(sid), 3000);
      }
    }
  },

  async _startAutoRecordStream(sessionId, maxDurationSec) {
    try {
      const result = await this.startStreamRecording(sessionId);
      if (result.error) {
        return;
      }
      console.log(
        "DRM auto-record: started stream for session " +
          sessionId +
          (maxDurationSec > 0
            ? " (max " + maxDurationSec + "s)"
            : " (until media ends)")
      );

      // If maxDurationSec > 0, set a safety-cap timer. Otherwise recording
      // continues until the media element fires "ended" or the session closes,
      // both of which trigger _autoStopSession.
      if (maxDurationSec > 0) {
        const timer = setTimeout(
          () => this._autoStopSession(sessionId, "max-duration"),
          maxDurationSec * 1000
        );
        this._autoRecordTimers.set(sessionId + "_stream", timer);
      }
    } catch (e) {
      console.warn("DRM auto-record stream error:", e);
    }
  },

  async _startAutoRecordFrames(sessionId, intervalSec) {
    let count = 0;
    const maxFrames = 10;
    const capture = async () => {
      if (this._destroyed || count >= maxFrames) {
        return;
      }
      try {
        const frame = await this.captureVideoFrame(sessionId);
        if (frame.dataUrl) {
          count++;
          await this._autoSaveDataUrl(
            frame.dataUrl,
            sessionId,
            "frame-" + count,
            "png"
          );
        }
      } catch {
        // Ignore
      }
      if (count < maxFrames && !this._destroyed) {
        const timer = setTimeout(capture, intervalSec * 1000);
        this._autoRecordTimers.set(sessionId + "_frame", timer);
      }
    };
    // First frame after a short delay
    const timer = setTimeout(capture, 2000);
    this._autoRecordTimers.set(sessionId + "_frame", timer);
  },

  async _autoExportSessionLog(sessionId) {
    if (this._destroyed) {
      return;
    }
    try {
      const state = this.store.getState();
      const session = state.sessions.list.find(s => s.sessionId === sessionId);
      if (!session) {
        return;
      }
      const data = {
        exportedAt: new Date().toISOString(),
        session,
        relatedEvents: state.eventLog.entries.filter(
          e => e.sessionId === sessionId || e.sessionId === ""
        ),
        config: state.config.list,
        diagnostics: state.diagnostics.list,
      };
      await this._autoSaveJson(data, sessionId, "log");
    } catch (e) {
      console.warn("DRM auto-record: log export failed", e);
    }
  },

  updateAutoRecordSettings(settings) {
    // Persist to prefs
    const prefMap = {
      enabled: ["devtools.drm.autorecord.enabled", "bool"],
      outputDir: ["devtools.drm.autorecord.outputDir", "char"],
      filenameTemplate: ["devtools.drm.autorecord.filenameTemplate", "char"],
      autoRecordStreams: ["devtools.drm.autorecord.streams", "bool"],
      autoRecordFrames: ["devtools.drm.autorecord.frames", "bool"],
      autoExportLogs: ["devtools.drm.autorecord.logs", "bool"],
      maxRecordingDurationSec: [
        "devtools.drm.autorecord.maxDurationSec",
        "int",
      ],
      frameIntervalSec: ["devtools.drm.autorecord.frameIntervalSec", "int"],
    };
    for (const [key, value] of Object.entries(settings)) {
      const mapping = prefMap[key];
      if (!mapping) {
        continue;
      }
      try {
        const [pref, type] = mapping;
        if (type === "bool") {
          Services.prefs.setBoolPref(pref, !!value);
        } else if (type === "int") {
          Services.prefs.setIntPref(pref, Number(value) || 0);
        } else {
          Services.prefs.setCharPref(pref, String(value));
        }
      } catch {
        // Ignore pref write failures
      }
    }
    this.actions.updateAutoRecord(settings);
  },

  async pickOutputDirectory() {
    const fp = Cc["@mozilla.org/filepicker;1"].createInstance(Ci.nsIFilePicker);
    const parentWin = Services.wm.getMostRecentBrowserWindow();
    fp.init(
      parentWin.browsingContext,
      "Select Auto-Record Output Directory",
      Ci.nsIFilePicker.modeGetFolder
    );
    const rv = await new Promise(resolve => fp.open(resolve));
    if (rv === Ci.nsIFilePicker.returnOK) {
      return fp.file.path;
    }
    return null;
  },

  async setEMEPref(name, value) {
    // Write prefs from the chrome process (initializer) instead of the
    // content-process actor to avoid NS_ERROR_NOT_AVAILABLE.
    try {
      if (typeof value === "boolean") {
        Services.prefs.setBoolPref(name, value);
      } else if (typeof value === "number") {
        Services.prefs.setIntPref(name, value);
      } else {
        Services.prefs.setCharPref(name, String(value));
      }
    } catch (e) {
      console.warn("DRM panel: failed to set pref " + name, e);
    }
    // Re-fetch config from actor (reads still work in content process)
    if (this._drmFront) {
      try {
        const config = await this._drmFront.getEMEConfig();
        this.actions.updateConfig(config);
      } catch {
        // Ignore
      }
    }
  },

  destroy() {
    this._destroyed = true;

    // Clean up auto-record timers
    for (const [, timer] of this._autoRecordTimers) {
      clearTimeout(timer);
    }
    this._autoRecordTimers.clear();
    this._autoRecordSeenSessions.clear();

    // Ensure EME capture pref is reset
    if (this._emeCaptureRefCount > 0) {
      this._emeCaptureRefCount = 0;
      try {
        Services.prefs.setBoolPref("media.eme.capture-allowed", false);
      } catch {
        // Ignore
      }
    }

    this.store.dispatch(START_IGNORE_ACTION);

    if (this._drmFront) {
      this._drmFront.off("drm-event", this._onDrmEvent);
      this._drmFront.off("sessions-updated", this._onSessionsUpdated);
      this._drmFront.off("media-ended", this._onMediaEnded);
      try {
        this._drmFront.stopObserving();
      } catch {
        // Ignore
      }
      this._drmFront = null;
    }

    this._commands.targetCommand.unwatchTargets({
      types: [this._commands.targetCommand.TYPES.FRAME],
      onAvailable: this._onTargetAvailable,
    });

    unmountComponentAtNode(this.mount);
    this.mount = null;
    this.toolbox = null;
    this._commands = null;
  },
};
