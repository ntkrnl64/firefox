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
  PureComponent,
} = require("resource://devtools/client/shared/vendor/react.mjs");
const PropTypes = require("resource://devtools/client/shared/vendor/react-prop-types.mjs");
const {
  connect,
} = require("resource://devtools/client/shared/vendor/react-redux.js");
const {
  div,
  h2,
  h4,
  table,
  thead,
  tbody,
  tr,
  th,
  td,
  span,
  button,
  ul,
  li,
  details,
  summary,
  pre,
  code,
} = require("resource://devtools/client/shared/vendor/react-dom-factories.js");

class OverviewPanel extends PureComponent {
  static get propTypes() {
    return {
      keySystems: PropTypes.array.isRequired,
      diagnostics: PropTypes.array.isRequired,
    };
  }

  renderResolvedConfig(config) {
    if (!config) {
      return null;
    }

    const sections = [];

    if (config.initDataTypes && config.initDataTypes.length) {
      sections.push(
        div(
          { key: "idt" },
          "Init Data Types: ",
          span({ className: "drm-mono" }, config.initDataTypes.join(", "))
        )
      );
    }

    if (config.sessionTypes && config.sessionTypes.length) {
      sections.push(
        div(
          { key: "st" },
          "Session Types: ",
          span({ className: "drm-mono" }, config.sessionTypes.join(", "))
        )
      );
    }

    sections.push(
      div(
        { key: "di" },
        "Distinctive Identifier: ",
        span({ className: "drm-mono" }, config.distinctiveIdentifier || "N/A")
      )
    );

    sections.push(
      div(
        { key: "ps" },
        "Persistent State: ",
        span({ className: "drm-mono" }, config.persistentState || "N/A")
      )
    );

    const renderCapabilities = (caps, label) => {
      if (!caps || caps.length === 0) {
        return null;
      }
      return div(
        { key: label },
        h4({}, label),
        table(
          { className: "drm-table drm-table--compact" },
          thead(
            {},
            tr(
              {},
              th({}, "Content Type"),
              th({}, "Robustness"),
              th({}, "Encryption Scheme")
            )
          ),
          tbody(
            {},
            caps.map((cap, i) =>
              tr(
                { key: i },
                td({}, span({ className: "drm-mono" }, cap.contentType)),
                td(
                  {},
                  span({ className: "drm-mono" }, cap.robustness || "(default)")
                ),
                td(
                  {},
                  span(
                    { className: "drm-mono" },
                    cap.encryptionScheme || "(any)"
                  )
                )
              )
            )
          )
        )
      );
    };

    sections.push(
      renderCapabilities(config.videoCapabilities, "Video Capabilities")
    );
    sections.push(
      renderCapabilities(config.audioCapabilities, "Audio Capabilities")
    );

    return div({ className: "drm-resolved-config" }, sections.filter(Boolean));
  }

  renderKeySystemsTable() {
    const { keySystems } = this.props;

    if (keySystems.length === 0) {
      return div(
        { className: "drm-empty" },
        "Loading key system information..."
      );
    }

    return div(
      {},
      keySystems.map(ks =>
        div(
          { key: ks.keySystem, className: "drm-keysystem-card" },
          div(
            { className: "drm-keysystem-card__header" },
            span(
              { className: "drm-keysystem-card__name" },
              ks.label || ks.keySystem
            ),
            span(
              { className: "drm-keysystem-card__id drm-mono" },
              ks.keySystem
            ),
            div(
              { className: "drm-keysystem-card__badges" },
              span(
                {
                  className: ks.available
                    ? "drm-badge drm-badge--success"
                    : "drm-badge drm-badge--error",
                },
                ks.available ? "Available" : "Not Available"
              ),
              ks.hardwareDecryption
                ? span(
                    {
                      className: ks.available
                        ? "drm-badge drm-badge--info"
                        : "drm-badge drm-badge--warning",
                    },
                    ks.available ? "HW Decryption" : "HW N/A"
                  )
                : null
            )
          ),
          ks.available && ks.resolvedConfig
            ? details(
                { className: "drm-keysystem-card__config" },
                summary({}, "Resolved Configuration"),
                this.renderResolvedConfig(ks.resolvedConfig)
              )
            : null
        )
      )
    );
  }

  renderDetail(detail) {
    if (detail.includes("\n")) {
      return pre({ className: "drm-diagnostics__detail" }, code({}, detail));
    }
    return div({ className: "drm-diagnostics__detail" }, detail);
  }

  renderDiagnostics() {
    const { diagnostics } = this.props;

    if (diagnostics.length === 0) {
      return null;
    }

    return div(
      { className: "drm-diagnostics" },
      h2({}, "Diagnostics"),
      ul(
        { className: "drm-diagnostics__list" },
        diagnostics.map((d, i) =>
          li(
            {
              key: i,
              className: `drm-diagnostics__item drm-diagnostics__item--${d.severity}`,
            },
            span({ className: "drm-diagnostics__severity" }, d.severity + ":"),
            " ",
            span({ className: "drm-diagnostics__message" }, d.message),
            d.detail ? this.renderDetail(d.detail) : null
          )
        )
      )
    );
  }

  render() {
    return div(
      { className: "drm-overview" },
      div(
        { className: "drm-section" },
        div(
          { className: "drm-section__header" },
          h2({}, "Key Systems"),
          button(
            {
              className: "drm-button",
              onClick: () => window.DrmApp.refreshData(),
            },
            "Refresh"
          )
        ),
        this.renderKeySystemsTable()
      ),
      this.renderDiagnostics()
    );
  }
}

function mapStateToProps(state) {
  return {
    keySystems: state.keySystems.list,
    diagnostics: state.diagnostics.list,
  };
}

module.exports = connect(mapStateToProps)(OverviewPanel);
