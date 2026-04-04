/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

const {
  UPDATE_CONFIG,
} = require("resource://devtools/client/drm/src/constants.js");

function ConfigState() {
  return {
    list: [],
  };
}

function configReducer(state = ConfigState(), action) {
  switch (action.type) {
    case UPDATE_CONFIG:
      return Object.assign({}, state, { list: action.config });
    default:
      return state;
  }
}

module.exports = { ConfigState, configReducer };
