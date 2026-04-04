/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

const {
  UPDATE_SESSIONS,
} = require("resource://devtools/client/drm/src/constants.js");

function updateSessions(sessions) {
  return { type: UPDATE_SESSIONS, sessions };
}

module.exports = { updateSessions };
