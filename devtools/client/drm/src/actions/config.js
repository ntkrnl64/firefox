/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

const {
  UPDATE_CONFIG,
} = require("resource://devtools/client/drm/src/constants.js");

function updateConfig(config) {
  return { type: UPDATE_CONFIG, config };
}

module.exports = { updateConfig };
