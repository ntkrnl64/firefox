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
  Arg,
  RetVal,
  generateActorSpec,
} = require("resource://devtools/shared/protocol.js");

const drmSpec = generateActorSpec({
  typeName: "drm",

  events: {
    "drm-event": {
      type: "drm-event",
      entry: Arg(0, "json"),
    },
    "sessions-updated": {
      type: "sessions-updated",
      sessions: Arg(0, "json"),
    },
    "media-ended": {
      type: "media-ended",
      data: Arg(0, "json"),
    },
  },

  methods: {
    getKeySystemAvailability: {
      request: {},
      response: RetVal("json"),
    },
    getActiveSessions: {
      request: {},
      response: RetVal("json"),
    },
    getEMEConfig: {
      request: {},
      response: RetVal("json"),
    },
    setEMEPref: {
      request: {
        name: Arg(0, "string"),
        value: Arg(1, "json"),
      },
      response: RetVal("json"),
    },
    getDiagnostics: {
      request: {},
      response: RetVal("json"),
    },
    getEventLog: {
      request: {},
      response: RetVal("json"),
    },
    captureVideoFrame: {
      request: {
        sessionId: Arg(0, "string"),
      },
      response: RetVal("json"),
    },
    getSessionMediaState: {
      request: {
        sessionId: Arg(0, "string"),
      },
      response: RetVal("json"),
    },
    getSessionDeepDebug: {
      request: {
        sessionId: Arg(0, "string"),
      },
      response: RetVal("json"),
    },
    startStreamRecording: {
      request: {
        sessionId: Arg(0, "string"),
      },
      response: RetVal("json"),
    },
    stopStreamRecording: {
      request: {
        sessionId: Arg(0, "string"),
      },
      response: RetVal("json"),
    },
    startObserving: {
      request: {},
      response: {},
    },
    stopObserving: {
      request: {},
      response: {},
    },
  },
});

exports.drmSpec = drmSpec;
