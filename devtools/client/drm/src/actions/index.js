/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// DISCLAIMER: This file is part of an unofficial Firefox modification that adds
// DRM/EME debugging tools. It is NOT endorsed by or affiliated with Mozilla.
// The DRM media capture functionality bypasses content protection restrictions
// and is intended ONLY for developer debugging and testing purposes.
// Do NOT use in production or to circumvent digital rights management.

"use strict";

const keysystems = require("resource://devtools/client/drm/src/actions/keysystems.js");
const sessions = require("resource://devtools/client/drm/src/actions/sessions.js");
const events = require("resource://devtools/client/drm/src/actions/events.js");
const config = require("resource://devtools/client/drm/src/actions/config.js");
const diagnostics = require("resource://devtools/client/drm/src/actions/diagnostics.js");
const ui = require("resource://devtools/client/drm/src/actions/ui.js");
const autorecord = require("resource://devtools/client/drm/src/actions/autorecord.js");
const triggers = require("resource://devtools/client/drm/src/actions/triggers.js");

Object.assign(
  exports,
  keysystems,
  sessions,
  events,
  config,
  diagnostics,
  ui,
  autorecord,
  triggers
);
