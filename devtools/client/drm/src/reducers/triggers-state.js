/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

const {
  UPDATE_TRIGGERS,
  UPDATE_BREAKPOINTS,
  UPDATE_BREAKPOINT_HITS,
  ADD_BREAKPOINT_HIT,
  CLEAR_BREAKPOINT_HITS,
  MAX_BREAKPOINT_HITS,
} = require("resource://devtools/client/drm/src/constants.js");

function TriggersState() {
  return {
    triggers: [],
    breakpoints: [],
    hits: [],
  };
}

function triggersReducer(state = TriggersState(), action) {
  switch (action.type) {
    case UPDATE_TRIGGERS:
      return Object.assign({}, state, { triggers: action.triggers || [] });
    case UPDATE_BREAKPOINTS:
      return Object.assign({}, state, {
        breakpoints: action.breakpoints || [],
      });
    case UPDATE_BREAKPOINT_HITS:
      return Object.assign({}, state, { hits: action.hits || [] });
    case ADD_BREAKPOINT_HIT: {
      let hits = [...state.hits, action.hit];
      if (hits.length > MAX_BREAKPOINT_HITS) {
        hits = hits.slice(hits.length - MAX_BREAKPOINT_HITS);
      }
      return Object.assign({}, state, { hits });
    }
    case CLEAR_BREAKPOINT_HITS:
      return Object.assign({}, state, { hits: [] });
    default:
      return state;
  }
}

module.exports = { TriggersState, triggersReducer };
