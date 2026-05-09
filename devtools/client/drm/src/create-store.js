/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// DISCLAIMER: This file is part of an unofficial Firefox modification that adds
// DRM/EME debugging tools. It is NOT endorsed by or affiliated with Mozilla.
// The DRM media capture functionality bypasses content protection restrictions
// and is intended ONLY for developer debugging and testing purposes.
// Do NOT use in production or to circumvent digital rights management.

"use strict";

const {
  ignore,
} = require("resource://devtools/client/shared/redux/middleware/ignore.js");
const {
  thunk,
} = require("resource://devtools/client/shared/redux/middleware/thunk.js");

const {
  applyMiddleware,
  createStore,
} = require("resource://devtools/client/shared/vendor/redux.js");

const rootReducer = require("resource://devtools/client/drm/src/reducers/index.js");
const {
  KeySystemsState,
} = require("resource://devtools/client/drm/src/reducers/keysystems-state.js");
const {
  SessionsState,
} = require("resource://devtools/client/drm/src/reducers/sessions-state.js");
const {
  EventLogState,
} = require("resource://devtools/client/drm/src/reducers/eventlog-state.js");
const {
  ConfigState,
} = require("resource://devtools/client/drm/src/reducers/config-state.js");
const {
  DiagnosticsState,
} = require("resource://devtools/client/drm/src/reducers/diagnostics-state.js");
const {
  UiState,
} = require("resource://devtools/client/drm/src/reducers/ui-state.js");
const {
  AutoRecordState,
} = require("resource://devtools/client/drm/src/reducers/autorecord-state.js");
const {
  TriggersState,
} = require("resource://devtools/client/drm/src/reducers/triggers-state.js");

function configureStore() {
  const initialState = {
    keySystems: new KeySystemsState(),
    sessions: new SessionsState(),
    eventLog: new EventLogState(),
    config: new ConfigState(),
    diagnostics: new DiagnosticsState(),
    ui: new UiState(),
    autorecord: new AutoRecordState(),
    triggers: new TriggersState(),
  };

  const middleware = applyMiddleware(ignore, thunk());

  return createStore(rootReducer, initialState, middleware);
}

exports.configureStore = configureStore;
