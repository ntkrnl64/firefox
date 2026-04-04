/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

const {
  ADD_DRM_EVENT,
  CLEAR_EVENT_LOG,
} = require("resource://devtools/client/drm/src/constants.js");

function addDrmEvent(entry) {
  return { type: ADD_DRM_EVENT, entry };
}

function clearEventLog() {
  return { type: CLEAR_EVENT_LOG };
}

module.exports = { addDrmEvent, clearEventLog };
