/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

const {
  combineReducers,
} = require("resource://devtools/client/shared/vendor/redux.js");
const {
  keySystemsReducer,
} = require("resource://devtools/client/drm/src/reducers/keysystems-state.js");
const {
  sessionsReducer,
} = require("resource://devtools/client/drm/src/reducers/sessions-state.js");
const {
  eventLogReducer,
} = require("resource://devtools/client/drm/src/reducers/eventlog-state.js");
const {
  configReducer,
} = require("resource://devtools/client/drm/src/reducers/config-state.js");
const {
  diagnosticsReducer,
} = require("resource://devtools/client/drm/src/reducers/diagnostics-state.js");
const {
  uiReducer,
} = require("resource://devtools/client/drm/src/reducers/ui-state.js");
const {
  autorecordReducer,
} = require("resource://devtools/client/drm/src/reducers/autorecord-state.js");
const {
  triggersReducer,
} = require("resource://devtools/client/drm/src/reducers/triggers-state.js");

module.exports = combineReducers({
  keySystems: keySystemsReducer,
  sessions: sessionsReducer,
  eventLog: eventLogReducer,
  config: configReducer,
  diagnostics: diagnosticsReducer,
  ui: uiReducer,
  autorecord: autorecordReducer,
  triggers: triggersReducer,
});
