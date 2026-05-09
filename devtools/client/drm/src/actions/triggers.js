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
} = require("resource://devtools/client/drm/src/constants.js");

function updateTriggers(triggers) {
  return { type: UPDATE_TRIGGERS, triggers };
}

function updateBreakpoints(breakpoints) {
  return { type: UPDATE_BREAKPOINTS, breakpoints };
}

function updateBreakpointHits(hits) {
  return { type: UPDATE_BREAKPOINT_HITS, hits };
}

function addBreakpointHit(hit) {
  return { type: ADD_BREAKPOINT_HIT, hit };
}

function clearBreakpointHits() {
  return { type: CLEAR_BREAKPOINT_HITS };
}

module.exports = {
  updateTriggers,
  updateBreakpoints,
  updateBreakpointHits,
  addBreakpointHit,
  clearBreakpointHits,
};
