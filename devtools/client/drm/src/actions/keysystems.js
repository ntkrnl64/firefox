/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

const {
  UPDATE_KEY_SYSTEMS,
} = require("resource://devtools/client/drm/src/constants.js");

function updateKeySystems(keySystems) {
  return { type: UPDATE_KEY_SYSTEMS, keySystems };
}

module.exports = { updateKeySystems };
