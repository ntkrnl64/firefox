/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// DISCLAIMER: This file is part of an unofficial Firefox modification that adds
// DRM/EME debugging tools. It is NOT endorsed by or affiliated with Mozilla.
// The DRM media capture functionality bypasses content protection restrictions
// and is intended ONLY for developer debugging and testing purposes.
// Do NOT use in production or to circumvent digital rights management.

"use strict";

const {
  UPDATE_AUTORECORD,
} = require("resource://devtools/client/drm/src/constants.js");

// Template variables for file names:
//   {sessionId}   - DRM session ID
//   {keySystem}   - key system name (e.g. "com.widevine.alpha")
//   {date}        - YYYY-MM-DD
//   {time}        - HH-MM-SS
//   {timestamp}   - Unix timestamp ms
//   {hostname}    - page hostname
//   {type}        - "recording", "frame", "log"
const DEFAULT_FILENAME_TEMPLATE = "{type}-{hostname}-{sessionId}-{date}_{time}";

function loadFromPrefs() {
  try {
    return {
      enabled: Services.prefs.getBoolPref(
        "devtools.drm.autorecord.enabled",
        false
      ),
      outputDir: Services.prefs.getCharPref(
        "devtools.drm.autorecord.outputDir",
        ""
      ),
      filenameTemplate: Services.prefs.getCharPref(
        "devtools.drm.autorecord.filenameTemplate",
        DEFAULT_FILENAME_TEMPLATE
      ),
      autoRecordStreams: Services.prefs.getBoolPref(
        "devtools.drm.autorecord.streams",
        true
      ),
      autoRecordFrames: Services.prefs.getBoolPref(
        "devtools.drm.autorecord.frames",
        false
      ),
      autoExportLogs: Services.prefs.getBoolPref(
        "devtools.drm.autorecord.logs",
        true
      ),
      maxRecordingDurationSec: Services.prefs.getIntPref(
        "devtools.drm.autorecord.maxDurationSec",
        30
      ),
      frameIntervalSec: Services.prefs.getIntPref(
        "devtools.drm.autorecord.frameIntervalSec",
        5
      ),
    };
  } catch {
    return {
      enabled: false,
      outputDir: "",
      filenameTemplate: DEFAULT_FILENAME_TEMPLATE,
      autoRecordStreams: true,
      autoRecordFrames: false,
      autoExportLogs: true,
      maxRecordingDurationSec: 30,
      frameIntervalSec: 5,
    };
  }
}

function AutoRecordState() {
  return loadFromPrefs();
}

function autorecordReducer(state = AutoRecordState(), action) {
  switch (action.type) {
    case UPDATE_AUTORECORD:
      return Object.assign({}, state, action.settings);
    default:
      return state;
  }
}

module.exports = {
  AutoRecordState,
  autorecordReducer,
  DEFAULT_FILENAME_TEMPLATE,
};
