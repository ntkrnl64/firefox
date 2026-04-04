/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

const {
  DEFAULT_TAB,
  SELECT_TAB,
} = require("resource://devtools/client/drm/src/constants.js");

function UiState() {
  return {
    selectedTab: DEFAULT_TAB,
  };
}

function uiReducer(state = UiState(), action) {
  switch (action.type) {
    case SELECT_TAB:
      return Object.assign({}, state, { selectedTab: action.selectedTab });
    default:
      return state;
  }
}

module.exports = { UiState, uiReducer };
