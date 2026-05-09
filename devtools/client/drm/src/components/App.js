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
  createFactory,
  PureComponent,
} = require("resource://devtools/client/shared/vendor/react.mjs");
const PropTypes = require("resource://devtools/client/shared/vendor/react-prop-types.mjs");
const {
  connect,
} = require("resource://devtools/client/shared/vendor/react-redux.js");
const {
  div,
  nav,
  button,
  span,
  a,
} = require("resource://devtools/client/shared/vendor/react-dom-factories.js");

const {
  TAB_TYPES,
} = require("resource://devtools/client/drm/src/constants.js");
const {
  selectTab,
} = require("resource://devtools/client/drm/src/actions/ui.js");

const OverviewPanel = createFactory(
  require("resource://devtools/client/drm/src/components/OverviewPanel.js")
);
const SessionsPanel = createFactory(
  require("resource://devtools/client/drm/src/components/SessionsPanel.js")
);
const EventLogPanel = createFactory(
  require("resource://devtools/client/drm/src/components/EventLogPanel.js")
);
const TriggeredByPanel = createFactory(
  require("resource://devtools/client/drm/src/components/TriggeredByPanel.js")
);
const ConfigPanel = createFactory(
  require("resource://devtools/client/drm/src/components/ConfigPanel.js")
);

const TAB_LABELS = {
  [TAB_TYPES.OVERVIEW]: "Overview",
  [TAB_TYPES.SESSIONS]: "Sessions",
  [TAB_TYPES.EVENT_LOG]: "Event Log",
  [TAB_TYPES.TRIGGERED_BY]: "Triggered By",
  [TAB_TYPES.CONFIG]: "Configuration",
};

class App extends PureComponent {
  static get propTypes() {
    return {
      selectedTab: PropTypes.string.isRequired,
      dispatch: PropTypes.func.isRequired,
    };
  }

  renderTabBar() {
    const { selectedTab, dispatch } = this.props;
    const tabs = Object.values(TAB_TYPES);

    return nav(
      { className: "drm-tab-bar" },
      tabs.map(tab =>
        button(
          {
            key: tab,
            className:
              "drm-tab-bar__item" +
              (tab === selectedTab ? " drm-tab-bar__item--selected" : ""),
            onClick: () => dispatch(selectTab(tab)),
          },
          TAB_LABELS[tab]
        )
      )
    );
  }

  renderActivePanel() {
    switch (this.props.selectedTab) {
      case TAB_TYPES.OVERVIEW:
        return OverviewPanel({});
      case TAB_TYPES.SESSIONS:
        return SessionsPanel({});
      case TAB_TYPES.EVENT_LOG:
        return EventLogPanel({});
      case TAB_TYPES.TRIGGERED_BY:
        return TriggeredByPanel({});
      case TAB_TYPES.CONFIG:
        return ConfigPanel({});
      default:
        return OverviewPanel({});
    }
  }

  renderDisclaimer() {
    return div(
      { className: "drm-disclaimer" },
      span({ className: "drm-disclaimer__icon" }, "\u26A0"),
      span(
        { className: "drm-disclaimer__text" },
        "UNOFFICIAL TOOL - This DRM debugging panel is not endorsed by Mozilla. " +
          "Media capture bypasses content protection and is for ",
        span(
          { className: "drm-disclaimer__emphasis" },
          "developer testing only"
        ),
        ". Do not use to circumvent DRM. See ",
        a(
          {
            className: "drm-disclaimer__link",
            href: "https://www.w3.org/TR/encrypted-media/",
            title: "W3C Encrypted Media Extensions specification",
          },
          "EME spec"
        ),
        " for compliance."
      )
    );
  }

  render() {
    return div(
      { className: "drm-app" },
      this.renderDisclaimer(),
      this.renderTabBar(),
      div({ className: "drm-panel-content" }, this.renderActivePanel())
    );
  }
}

function mapStateToProps(state) {
  return {
    selectedTab: state.ui.selectedTab,
  };
}

module.exports = connect(mapStateToProps)(App);
