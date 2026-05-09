/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// DISCLAIMER: This file is part of an unofficial Firefox modification that adds
// DRM/EME debugging tools. It is NOT endorsed by or affiliated with Mozilla.
// The DRM media capture functionality bypasses content protection restrictions
// and is intended ONLY for developer debugging and testing purposes.
// Do NOT use in production or to circumvent digital rights management.

"use strict";

const actionTypes = {
  UPDATE_KEY_SYSTEMS: "UPDATE_KEY_SYSTEMS",
  UPDATE_SESSIONS: "UPDATE_SESSIONS",
  ADD_DRM_EVENT: "ADD_DRM_EVENT",
  CLEAR_EVENT_LOG: "CLEAR_EVENT_LOG",
  UPDATE_CONFIG: "UPDATE_CONFIG",
  UPDATE_DIAGNOSTICS: "UPDATE_DIAGNOSTICS",
  SELECT_TAB: "SELECT_TAB",
  UPDATE_AUTORECORD: "UPDATE_AUTORECORD",
  UPDATE_TRIGGERS: "UPDATE_TRIGGERS",
  UPDATE_BREAKPOINTS: "UPDATE_BREAKPOINTS",
  UPDATE_BREAKPOINT_HITS: "UPDATE_BREAKPOINT_HITS",
  ADD_BREAKPOINT_HIT: "ADD_BREAKPOINT_HIT",
  CLEAR_BREAKPOINT_HITS: "CLEAR_BREAKPOINT_HITS",
};

const TAB_TYPES = {
  OVERVIEW: "overview",
  SESSIONS: "sessions",
  EVENT_LOG: "eventlog",
  TRIGGERED_BY: "triggeredby",
  CONFIG: "config",
};

const DEFAULT_TAB = TAB_TYPES.OVERVIEW;

const MAX_EVENT_LOG_ENTRIES = 1000;
const MAX_BREAKPOINT_HITS = 200;

// EME entry-point methods that "trigger" DRM — every hit on one of these is
// a candidate for the Triggered By view.
const TRIGGER_METHODS = [
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

module.exports = Object.assign(
  {},
  {
    TAB_TYPES,
    DEFAULT_TAB,
    MAX_EVENT_LOG_ENTRIES,
    MAX_BREAKPOINT_HITS,
    TRIGGER_METHODS,
  },
  actionTypes
);
