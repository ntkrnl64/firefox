/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

const {
  ADD_DRM_EVENT,
  CLEAR_EVENT_LOG,
  MAX_EVENT_LOG_ENTRIES,
} = require("resource://devtools/client/drm/src/constants.js");

function EventLogState() {
  return {
    entries: [],
  };
}

function eventLogReducer(state = EventLogState(), action) {
  switch (action.type) {
    case ADD_DRM_EVENT: {
      let entries = [...state.entries, action.entry];
      if (entries.length > MAX_EVENT_LOG_ENTRIES) {
        entries = entries.slice(entries.length - MAX_EVENT_LOG_ENTRIES);
      }
      return Object.assign({}, state, { entries });
    }
    case CLEAR_EVENT_LOG:
      return Object.assign({}, state, { entries: [] });
    default:
      return state;
  }
}

module.exports = { EventLogState, eventLogReducer };
