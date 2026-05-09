/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// DISCLAIMER: This file is part of an unofficial Firefox modification that adds
// DRM/EME debugging tools. It is NOT endorsed by or affiliated with Mozilla.

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
  h3,
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
  input,
  select,
  option,
  label,
  form,
} = require("resource://devtools/client/shared/vendor/react-dom-factories.js");

const {
  TRIGGER_METHODS,
} = require("resource://devtools/client/drm/src/constants.js");

const {
  clearBreakpointHits,
} = require("resource://devtools/client/drm/src/actions/triggers.js");

const ALL_METHODS = ["ANY", ...TRIGGER_METHODS, "message", "keystatuseschange"];
const MATCH_TYPES = ["substring", "wildcard", "regex"];

class TriggeredByPanel extends Component {
  static get propTypes() {
    return {
      triggers: PropTypes.array.isRequired,
      breakpoints: PropTypes.array.isRequired,
      hits: PropTypes.array.isRequired,
      dispatch: PropTypes.func.isRequired,
    };
  }

  constructor(props) {
    super(props);
    this._triggerListRef = createRef();
    this.state = {
      filter: "",
      expandedTriggers: new Set(),
      expandedHits: new Set(),
      bpForm: this._defaultForm(),
    };
  }

  _defaultForm() {
    return {
      method: "ANY",
      keySystem: "",
      initDataType: "",
      pattern: "",
      matchType: "substring",
      cancelOnHit: false,
      pauseOnHit: false,
    };
  }

  formatTimestamp(ts) {
    if (!ts) {
      return "";
    }
    const d = new Date(ts);
    return (
      d.toLocaleTimeString() +
      "." +
      String(d.getMilliseconds()).padStart(3, "0")
    );
  }

  toggleTrigger(i) {
    const exp = new Set(this.state.expandedTriggers);
    if (exp.has(i)) {
      exp.delete(i);
    } else {
      exp.add(i);
    }
    this.setState({ expandedTriggers: exp });
  }

  toggleHit(i) {
    const exp = new Set(this.state.expandedHits);
    if (exp.has(i)) {
      exp.delete(i);
    } else {
      exp.add(i);
    }
    this.setState({ expandedHits: exp });
  }

  handleFormChange(field, value) {
    this.setState({
      bpForm: Object.assign({}, this.state.bpForm, { [field]: value }),
    });
  }

  async handleAddBreakpoint(e) {
    e.preventDefault();
    const f = this.state.bpForm;
    const spec = {
      method: f.method || "ANY",
      keySystem: f.keySystem.trim() || null,
      initDataType: f.initDataType.trim() || null,
      pattern: f.pattern.trim() || null,
      matchType: f.matchType,
      cancelOnHit: !!f.cancelOnHit,
      pauseOnHit: !!f.pauseOnHit,
    };
    if (window.DrmApp?.addDrmBreakpoint) {
      try {
        await window.DrmApp.addDrmBreakpoint(spec);
        this.setState({ bpForm: this._defaultForm() });
      } catch (err) {
        // eslint-disable-next-line no-alert
        alert("Failed to add breakpoint: " + err.message);
      }
    }
  }

  async handleRemoveBreakpoint(id) {
    if (window.DrmApp?.removeDrmBreakpoint) {
      try {
        await window.DrmApp.removeDrmBreakpoint(id);
      } catch {
        // Ignore
      }
    }
  }

  async handleToggleBreakpoint(id, enabled) {
    if (window.DrmApp?.updateDrmBreakpoint) {
      try {
        await window.DrmApp.updateDrmBreakpoint(id, { enabled });
      } catch {
        // Ignore
      }
    }
  }

  renderHeroTrigger() {
    const { triggers } = this.props;
    if (!triggers.length) {
      return div(
        { className: "drm-empty" },
        "No DRM activity captured yet. The first EME API call will appear here."
      );
    }
    const first = triggers[0];
    return div(
      { className: "drm-trigger-hero" },
      h3({}, "What triggered this DRM activation?"),
      div(
        { className: "drm-trigger-hero__line" },
        span({ className: "drm-event-type" }, first.method),
        first.keySystem
          ? span({ className: "drm-mono" }, " " + first.keySystem)
          : null,
        " at ",
        span({ className: "drm-mono" }, this.formatTimestamp(first.timestamp))
      ),
      first.detail
        ? div({ className: "drm-trigger-hero__detail" }, first.detail)
        : null,
      first.stack
        ? pre(
            { className: "drm-event-detail__stack" },
            code({}, first.stack)
          )
        : div(
            { className: "drm-empty" },
            "(no JS stack — invocation came from native code)"
          )
    );
  }

  renderTriggerTable() {
    const { triggers } = this.props;
    const { filter, expandedTriggers } = this.state;
    const filtered = filter
      ? triggers.filter(
          t =>
            t.method === filter ||
            (t.keySystem || "").includes(filter) ||
            (t.detail || "").includes(filter)
        )
      : triggers;

    const counts = {};
    for (const t of triggers) {
      counts[t.method] = (counts[t.method] || 0) + 1;
    }

    return div(
      { className: "drm-eventlog" },
      div(
        { className: "drm-section__header" },
        h3({}, "All EME entry-point invocations (" + triggers.length + ")")
      ),
      triggers.length
        ? div(
            { className: "drm-eventlog__filter-bar" },
            span(
              { className: "drm-eventlog__filter-label" },
              "Filter: "
            ),
            button(
              {
                className:
                  "drm-filter-btn" +
                  (!filter ? " drm-filter-btn--active" : ""),
                onClick: () => this.setState({ filter: "" }),
              },
              "All"
            ),
            Object.entries(counts).map(([m, c]) =>
              button(
                {
                  key: m,
                  className:
                    "drm-filter-btn" +
                    (filter === m ? " drm-filter-btn--active" : ""),
                  onClick: () =>
                    this.setState({ filter: filter === m ? "" : m }),
                },
                m + " (" + c + ")"
              )
            )
          )
        : null,
      filtered.length === 0 && triggers.length
        ? div(
            { className: "drm-empty" },
            "No triggers match the selected filter."
          )
        : null,
      filtered.length
        ? div(
            { className: "drm-eventlog__scroll", ref: this._triggerListRef },
            table(
              { className: "drm-table drm-table--full drm-table--eventlog" },
              thead(
                {},
                tr(
                  {},
                  th({ className: "drm-eventlog__col-expand" }, ""),
                  th({ className: "drm-eventlog__col-time" }, "Time"),
                  th({ className: "drm-eventlog__col-type" }, "Method"),
                  th({}, "Key System"),
                  th({}, "Detail")
                )
              ),
              tbody(
                {},
                filtered.map((t, i) => {
                  const hasStack = !!t.stack;
                  const isExpanded = expandedTriggers.has(i);
                  const rows = [
                    tr(
                      {
                        key: "row-" + i,
                        className:
                          "drm-event--message" +
                          (hasStack ? " drm-event--expandable" : "") +
                          (isExpanded ? " drm-event--expanded" : ""),
                        onClick: hasStack
                          ? () => this.toggleTrigger(i)
                          : undefined,
                      },
                      td(
                        { className: "drm-eventlog__expand-cell" },
                        hasStack
                          ? span(
                              { className: "drm-expand-arrow" },
                              isExpanded ? "▼" : "▶"
                            )
                          : null
                      ),
                      td(
                        { className: "drm-mono" },
                        this.formatTimestamp(t.timestamp)
                      ),
                      td({}, span({ className: "drm-event-type" }, t.method)),
                      td({ className: "drm-mono" }, t.keySystem || "-"),
                      td({}, t.detail || "")
                    ),
                  ];
                  if (isExpanded && hasStack) {
                    rows.push(
                      tr(
                        {
                          key: "stack-" + i,
                          className: "drm-event-detail-row",
                        },
                        td(
                          { colSpan: 5 },
                          div(
                            { className: "drm-event-detail" },
                            div(
                              { className: "drm-event-detail__section" },
                              div(
                                { className: "drm-event-detail__label" },
                                "Stack Trace:"
                              ),
                              pre(
                                { className: "drm-event-detail__stack" },
                                code({}, t.stack)
                              )
                            )
                          )
                        )
                      )
                    );
                  }
                  return rows;
                })
              )
            )
          )
        : null
    );
  }

  renderBreakpointForm() {
    const f = this.state.bpForm;
    return form(
      {
        className: "drm-bp-form",
        onSubmit: e => this.handleAddBreakpoint(e),
      },
      h3({}, "Add DRM breakpoint"),
      div(
        { className: "drm-bp-form__row" },
        label(
          {},
          "Method ",
          select(
            {
              value: f.method,
              onChange: e => this.handleFormChange("method", e.target.value),
            },
            ALL_METHODS.map(m => option({ key: m, value: m }, m))
          )
        ),
        label(
          {},
          "Key system ",
          input({
            type: "text",
            value: f.keySystem,
            placeholder: "(any)",
            onChange: e => this.handleFormChange("keySystem", e.target.value),
          })
        ),
        label(
          {},
          "initDataType ",
          select(
            {
              value: f.initDataType,
              onChange: e =>
                this.handleFormChange("initDataType", e.target.value),
            },
            option({ value: "" }, "(any)"),
            option({ value: "cenc" }, "cenc"),
            option({ value: "keyids" }, "keyids"),
            option({ value: "webm" }, "webm")
          )
        )
      ),
      div(
        { className: "drm-bp-form__row" },
        label(
          {},
          "Pattern ",
          input({
            type: "text",
            value: f.pattern,
            placeholder: "matched against initData hex / sessionId / args",
            size: 50,
            onChange: e => this.handleFormChange("pattern", e.target.value),
          })
        ),
        label(
          {},
          "Match type ",
          select(
            {
              value: f.matchType,
              onChange: e => this.handleFormChange("matchType", e.target.value),
            },
            MATCH_TYPES.map(m => option({ key: m, value: m }, m))
          )
        )
      ),
      div(
        { className: "drm-bp-form__row" },
        label(
          {},
          input({
            type: "checkbox",
            checked: f.cancelOnHit,
            onChange: e =>
              this.handleFormChange("cancelOnHit", e.target.checked),
          }),
          " Cancel matching call (throws OperationError)"
        ),
        label(
          {},
          input({
            type: "checkbox",
            checked: f.pauseOnHit,
            onChange: e =>
              this.handleFormChange("pauseOnHit", e.target.checked),
          }),
          " Pause in JS debugger on hit"
        ),
        button(
          {
            type: "submit",
            className: "drm-button drm-button--primary",
          },
          "Add breakpoint"
        )
      )
    );
  }

  renderBreakpointList() {
    const { breakpoints } = this.props;
    if (!breakpoints.length) {
      return div(
        { className: "drm-empty" },
        "No breakpoints. Add one above to capture stacks (and optionally cancel or pause) when a matching EME call happens."
      );
    }
    return table(
      { className: "drm-table drm-table--full" },
      thead(
        {},
        tr(
          {},
          th({}, "On"),
          th({}, "Method"),
          th({}, "Key system"),
          th({}, "initDataType"),
          th({}, "Pattern"),
          th({}, "Action"),
          th({}, "Hits"),
          th({}, "")
        )
      ),
      tbody(
        {},
        breakpoints.map(bp =>
          tr(
            { key: bp.id },
            td(
              {},
              input({
                type: "checkbox",
                checked: bp.enabled !== false,
                onChange: e =>
                  this.handleToggleBreakpoint(bp.id, e.target.checked),
              })
            ),
            td(
              {},
              span({ className: "drm-event-type" }, bp.method || "ANY")
            ),
            td({ className: "drm-mono" }, bp.keySystem || "-"),
            td({ className: "drm-mono" }, bp.initDataType || "-"),
            td(
              { className: "drm-mono" },
              bp.pattern
                ? span(
                    {},
                    span({ className: "drm-bp-matchtype" }, bp.matchType + ":"),
                    bp.pattern
                  )
                : "-"
            ),
            td(
              {},
              bp.cancelOnHit ? span({ className: "drm-bp-flag" }, "cancel") : null,
              bp.pauseOnHit ? span({ className: "drm-bp-flag" }, "pause") : null,
              !bp.cancelOnHit && !bp.pauseOnHit ? "capture" : null
            ),
            td({ className: "drm-mono" }, String(bp.hits || 0)),
            td(
              {},
              button(
                {
                  className: "drm-button",
                  onClick: () => this.handleRemoveBreakpoint(bp.id),
                },
                "Remove"
              )
            )
          )
        )
      )
    );
  }

  renderHits() {
    const { hits, dispatch } = this.props;
    const { expandedHits } = this.state;
    return div(
      { className: "drm-eventlog" },
      div(
        { className: "drm-section__header" },
        h3({}, "Breakpoint hits (" + hits.length + ")"),
        hits.length
          ? button(
              {
                className: "drm-button",
                onClick: () => dispatch(clearBreakpointHits()),
              },
              "Clear"
            )
          : null
      ),
      hits.length === 0
        ? div(
            { className: "drm-empty" },
            "No breakpoint hits yet. Hits will appear here as matching EME calls happen."
          )
        : table(
            { className: "drm-table drm-table--full drm-table--eventlog" },
            thead(
              {},
              tr(
                {},
                th({ className: "drm-eventlog__col-expand" }, ""),
                th({ className: "drm-eventlog__col-time" }, "Time"),
                th({ className: "drm-eventlog__col-type" }, "Method"),
                th({}, "Match"),
                th({}, "Detail")
              )
            ),
            tbody(
              {},
              hits.map((h, i) => {
                const hasStack = !!h.stack;
                const isExpanded = expandedHits.has(i);
                const rows = [
                  tr(
                    {
                      key: "hit-" + i,
                      className:
                        "drm-event--encrypted" +
                        (hasStack ? " drm-event--expandable" : "") +
                        (isExpanded ? " drm-event--expanded" : ""),
                      onClick: hasStack ? () => this.toggleHit(i) : undefined,
                    },
                    td(
                      { className: "drm-eventlog__expand-cell" },
                      hasStack
                        ? span(
                            { className: "drm-expand-arrow" },
                            isExpanded ? "▼" : "▶"
                          )
                        : null
                    ),
                    td(
                      { className: "drm-mono" },
                      this.formatTimestamp(h.timestamp)
                    ),
                    td({}, span({ className: "drm-event-type" }, h.method)),
                    td({ className: "drm-mono" }, h.bpId || h.pattern || "-"),
                    td({}, h.detail || "")
                  ),
                ];
                if (isExpanded && hasStack) {
                  rows.push(
                    tr(
                      {
                        key: "hit-stack-" + i,
                        className: "drm-event-detail-row",
                      },
                      td(
                        { colSpan: 5 },
                        div(
                          { className: "drm-event-detail" },
                          div(
                            { className: "drm-event-detail__section" },
                            div(
                              { className: "drm-event-detail__label" },
                              "Stack Trace:"
                            ),
                            pre(
                              { className: "drm-event-detail__stack" },
                              code({}, h.stack)
                            )
                          )
                        )
                      )
                    )
                  );
                }
                return rows;
              })
            )
          )
    );
  }

  render() {
    return div(
      { className: "drm-triggered-by" },
      div({ className: "drm-trigger-section" }, this.renderHeroTrigger()),
      div(
        { className: "drm-trigger-section" },
        this.renderBreakpointForm(),
        this.renderBreakpointList()
      ),
      div({ className: "drm-trigger-section" }, this.renderHits()),
      div({ className: "drm-trigger-section" }, this.renderTriggerTable())
    );
  }
}

function mapStateToProps(state) {
  return {
    triggers: state.triggers.triggers,
    breakpoints: state.triggers.breakpoints,
    hits: state.triggers.hits,
  };
}

module.exports = connect(mapStateToProps)(TriggeredByPanel);
