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
  createRef,
  Component,
} = require("resource://devtools/client/shared/vendor/react.mjs");
const PropTypes = require("resource://devtools/client/shared/vendor/react-prop-types.mjs");
const {
  connect,
} = require("resource://devtools/client/shared/vendor/react-redux.js");
const {
  div,
  h2,
  table,
  thead,
  tbody,
  tr,
  th,
  td,
  span,
  button,
  pre,
  code,
} = require("resource://devtools/client/shared/vendor/react-dom-factories.js");

const {
  clearEventLog,
} = require("resource://devtools/client/drm/src/actions/events.js");

const EVENT_TYPE_CLASSES = {
  message: "drm-event--message",
  keystatuseschange: "drm-event--keystatus",
  "session-created": "drm-event--session",
  "session-closed": "drm-event--closed",
  encrypted: "drm-event--encrypted",
  error: "drm-event--error",
  generateRequest: "drm-event--message",
  "generateRequest-resolved": "drm-event--session",
  "generateRequest-error": "drm-event--error",
  update: "drm-event--message",
  "update-resolved": "drm-event--session",
  "update-error": "drm-event--error",
  "close-called": "drm-event--closed",
  "close-resolved": "drm-event--closed",
  "close-error": "drm-event--error",
  "remove-called": "drm-event--closed",
  "remove-resolved": "drm-event--closed",
  "remove-error": "drm-event--error",
  setServerCertificate: "drm-event--message",
  "setServerCertificate-result": "drm-event--session",
  "setServerCertificate-error": "drm-event--error",
  requestMediaKeySystemAccess: "drm-event--message",
  "mediaKeySystemAccess-granted": "drm-event--session",
  "mediaKeySystemAccess-denied": "drm-event--error",
};

class EventLogPanel extends Component {
  static get propTypes() {
    return {
      entries: PropTypes.array.isRequired,
      dispatch: PropTypes.func.isRequired,
    };
  }

  constructor(props) {
    super(props);
    this._listRef = createRef();
    this.state = { expandedRows: new Set(), filter: "" };
  }

  componentDidUpdate(prevProps) {
    if (
      this._listRef.current &&
      prevProps.entries.length < this.props.entries.length
    ) {
      this._listRef.current.scrollTop = this._listRef.current.scrollHeight;
    }
  }

  toggleRow(index) {
    const expanded = new Set(this.state.expandedRows);
    if (expanded.has(index)) {
      expanded.delete(index);
    } else {
      expanded.add(index);
    }
    this.setState({ expandedRows: expanded });
  }

  formatTimestamp(ts) {
    const d = new Date(ts);
    return (
      d.toLocaleTimeString() +
      "." +
      String(d.getMilliseconds()).padStart(3, "0")
    );
  }

  hasExpandableContent(entry) {
    return !!(
      entry.stack ||
      (entry.extra && !!Object.keys(entry.extra).length)
    );
  }

  renderExpandedContent(entry) {
    const parts = [];

    if (entry.stack) {
      parts.push(
        div(
          { key: "stack", className: "drm-event-detail__section" },
          div({ className: "drm-event-detail__label" }, "Stack Trace:"),
          pre({ className: "drm-event-detail__stack" }, code({}, entry.stack))
        )
      );
    }

    if (entry.extra) {
      const extraEntries = Object.entries(entry.extra);
      for (const [key, value] of extraEntries) {
        if (value === null || value === undefined) {
          continue;
        }
        let display;
        if (typeof value === "object") {
          display = pre(
            { className: "drm-event-detail__json" },
            code({}, JSON.stringify(value, null, 2))
          );
        } else if (
          typeof value === "string" &&
          (key.endsWith("Hex") || key.endsWith("Base64")) &&
          value.length > 80
        ) {
          display = pre(
            { className: "drm-event-detail__hex" },
            code({}, value)
          );
        } else {
          display = span({ className: "drm-mono" }, String(value));
        }

        parts.push(
          div(
            { key, className: "drm-event-detail__section" },
            div({ className: "drm-event-detail__label" }, key + ":"),
            display
          )
        );
      }
    }

    return div({ className: "drm-event-detail" }, parts);
  }

  renderFilterBar() {
    const { filter } = this.state;
    const counts = {};
    for (const entry of this.props.entries) {
      counts[entry.type] = (counts[entry.type] || 0) + 1;
    }

    return div(
      { className: "drm-eventlog__filter-bar" },
      span({ className: "drm-eventlog__filter-label" }, "Filter: "),
      button(
        {
          className:
            "drm-filter-btn" + (!filter ? " drm-filter-btn--active" : ""),
          onClick: () => this.setState({ filter: "" }),
        },
        "All"
      ),
      Object.entries(counts).map(([type, count]) =>
        button(
          {
            key: type,
            className:
              "drm-filter-btn" +
              (filter === type ? " drm-filter-btn--active" : ""),
            onClick: () =>
              this.setState({ filter: filter === type ? "" : type }),
          },
          type + " (" + count + ")"
        )
      )
    );
  }

  render() {
    const { entries, dispatch } = this.props;
    const { filter, expandedRows } = this.state;

    const filtered = filter ? entries.filter(e => e.type === filter) : entries;

    return div(
      { className: "drm-eventlog" },
      div(
        { className: "drm-section__header" },
        h2({}, "Event Log (" + entries.length + ")"),
        div(
          { className: "drm-eventlog__actions" },
          button(
            {
              className: "drm-button",
              onClick: () => window.DrmApp.exportToClipboard(),
              title: "Copy all logs as JSON to clipboard",
            },
            "Copy to Clipboard"
          ),
          button(
            {
              className: "drm-button",
              onClick: () => window.DrmApp.exportToFile(),
              title: "Save all logs as a JSON file",
            },
            "Save to File"
          ),
          button(
            {
              className: "drm-button",
              onClick: () => {
                this.setState({ expandedRows: new Set() });
                dispatch(clearEventLog());
              },
            },
            "Clear"
          )
        )
      ),
      entries.length ? this.renderFilterBar() : null,
      filtered.length === 0
        ? div(
            { className: "drm-empty" },
            entries.length === 0
              ? "No DRM events recorded yet. Events will appear here as EME API calls occur."
              : "No events match the selected filter."
          )
        : div(
            { className: "drm-eventlog__scroll", ref: this._listRef },
            table(
              { className: "drm-table drm-table--full drm-table--eventlog" },
              thead(
                {},
                tr(
                  {},
                  th({ className: "drm-eventlog__col-expand" }, ""),
                  th({ className: "drm-eventlog__col-time" }, "Time"),
                  th({ className: "drm-eventlog__col-type" }, "Event"),
                  th({ className: "drm-eventlog__col-session" }, "Session"),
                  th({}, "Detail")
                )
              ),
              tbody(
                {},
                filtered.map((entry, i) => {
                  const isExpanded = expandedRows.has(i);
                  const hasDetail = this.hasExpandableContent(entry);
                  const rows = [
                    tr(
                      {
                        key: "row-" + i,
                        className:
                          (EVENT_TYPE_CLASSES[entry.type] || "") +
                          (hasDetail ? " drm-event--expandable" : "") +
                          (isExpanded ? " drm-event--expanded" : ""),
                        onClick: hasDetail
                          ? () => this.toggleRow(i)
                          : undefined,
                      },
                      td(
                        { className: "drm-eventlog__expand-cell" },
                        hasDetail
                          ? span(
                              { className: "drm-expand-arrow" },
                              isExpanded ? "\u25BC" : "\u25B6"
                            )
                          : null
                      ),
                      td(
                        { className: "drm-mono" },
                        this.formatTimestamp(entry.timestamp)
                      ),
                      td({}, span({ className: "drm-event-type" }, entry.type)),
                      td({ className: "drm-mono" }, entry.sessionId || "-"),
                      td({}, entry.detail || "")
                    ),
                  ];
                  if (isExpanded && hasDetail) {
                    rows.push(
                      tr(
                        {
                          key: "detail-" + i,
                          className: "drm-event-detail-row",
                        },
                        td({ colSpan: 5 }, this.renderExpandedContent(entry))
                      )
                    );
                  }
                  return rows;
                })
              )
            )
          )
    );
  }
}

function mapStateToProps(state) {
  return {
    entries: state.eventLog.entries,
  };
}

module.exports = connect(mapStateToProps)(EventLogPanel);
