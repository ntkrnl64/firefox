/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

const {
  UPDATE_KEY_SYSTEMS,
} = require("resource://devtools/client/drm/src/constants.js");

function KeySystemsState() {
  return {
    list: [],
  };
}

function keySystemsReducer(state = KeySystemsState(), action) {
  switch (action.type) {
    case UPDATE_KEY_SYSTEMS:
      return Object.assign({}, state, { list: action.keySystems });
    default:
      return state;
  }
}

module.exports = { KeySystemsState, keySystemsReducer };
