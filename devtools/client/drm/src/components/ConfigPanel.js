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
  input,
  span,
  button,
  label,
  p,
  code,
} = require("resource://devtools/client/shared/vendor/react-dom-factories.js");

class ConfigPanel extends Component {
  static get propTypes() {
    return {
      config: PropTypes.array.isRequired,
      autorecord: PropTypes.object.isRequired,
    };
  }

  onToggle(name, currentValue) {
    window.DrmApp.setEMEPref(name, !currentValue);
  }

  onAutoRecordChange(key, value) {
    window.DrmApp.updateAutoRecordSettings({ [key]: value });
  }

  async onPickOutputDir() {
    const dir = await window.DrmApp.pickOutputDirectory();
    if (dir) {
      window.DrmApp.updateAutoRecordSettings({ outputDir: dir });
    }
  }

  renderEMEConfig() {
    const { config } = this.props;

    if (config.length === 0) {
      return div({ className: "drm-empty" }, "Loading configuration...");
    }

    return div(
      { className: "drm-section" },
      div(
        { className: "drm-section__header" },
        h2({}, "EME Configuration"),
        button(
          {
            className: "drm-button",
            onClick: () => window.DrmApp.refreshData(),
          },
          "Refresh"
        )
      ),
      table(
        { className: "drm-table drm-table--full" },
        thead(
          {},
          tr({}, th({}, "Preference"), th({}, "Value"), th({}, "Action"))
        ),
        tbody(
          {},
          config.map(c =>
            tr(
              { key: c.name },
              td({}, span({ className: "drm-mono" }, c.name)),
              td(
                {},
                c.type === "boolean"
                  ? span(
                      {
                        className: c.value
                          ? "drm-badge drm-badge--success"
                          : "drm-badge drm-badge--error",
                      },
                      String(c.value)
                    )
                  : span({ className: "drm-mono" }, String(c.value))
              ),
              td(
                {},
                c.type === "boolean"
                  ? input({
                      type: "checkbox",
                      checked: c.value,
                      onChange: () => this.onToggle(c.name, c.value),
                    })
                  : null
              )
            )
          )
        )
      )
    );
  }

  renderAutoRecordConfig() {
    const ar = this.props.autorecord;

    return div(
      { className: "drm-section drm-autorecord-section" },
      h2({}, "Auto-Record"),
      div(
        { className: "drm-disclaimer drm-disclaimer--inline" },
        "Recording bypasses DRM output protection (media.eme.capture-allowed). " +
          "For developer testing only. Do not use to redistribute protected content."
      ),
      p(
        { className: "drm-autorecord-desc" },
        "Automatically record decrypted streams, capture frames, and export logs " +
          "when a new DRM session gets a usable key. Files are saved to the configured " +
          "output directory."
      ),

      // Master enable
      div(
        { className: "drm-autorecord-row" },
        label(
          { className: "drm-autorecord-label" },
          input({
            type: "checkbox",
            checked: ar.enabled,
            onChange: e => this.onAutoRecordChange("enabled", e.target.checked),
          }),
          span(
            {
              className: ar.enabled
                ? "drm-badge drm-badge--success"
                : "drm-badge",
            },
            ar.enabled ? "Enabled" : "Disabled"
          ),
          " Auto-record on new sessions"
        )
      ),

      // Output directory
      div(
        { className: "drm-autorecord-row" },
        label({ className: "drm-autorecord-label--block" }, "Output Directory"),
        div(
          { className: "drm-autorecord-dir-row" },
          input({
            type: "text",
            className: "drm-autorecord-input drm-autorecord-input--wide",
            value: ar.outputDir || "",
            placeholder: "Select a directory...",
            onChange: e => this.onAutoRecordChange("outputDir", e.target.value),
          }),
          button(
            {
              className: "drm-button",
              onClick: () => this.onPickOutputDir(),
            },
            "Browse..."
          )
        )
      ),

      // Filename template
      div(
        { className: "drm-autorecord-row" },
        label(
          { className: "drm-autorecord-label--block" },
          "Filename Template"
        ),
        input({
          type: "text",
          className: "drm-autorecord-input drm-autorecord-input--wide",
          value: ar.filenameTemplate || "",
          onChange: e =>
            this.onAutoRecordChange("filenameTemplate", e.target.value),
        }),
        div(
          { className: "drm-autorecord-hint" },
          "Variables: ",
          code({}, "{sessionId}"),
          " ",
          code({}, "{keySystem}"),
          " ",
          code({}, "{date}"),
          " ",
          code({}, "{time}"),
          " ",
          code({}, "{timestamp}"),
          " ",
          code({}, "{hostname}"),
          " ",
          code({}, "{type}")
        ),
        ar.filenameTemplate
          ? div(
              { className: "drm-autorecord-preview" },
              "Preview: ",
              span(
                { className: "drm-mono" },
                ar.filenameTemplate
                  .replace("{sessionId}", "42")
                  .replace("{keySystem}", "com_widevine_alpha")
                  .replace("{date}", new Date().toISOString().substring(0, 10))
                  .replace(
                    "{time}",
                    new Date().toTimeString().substring(0, 8).replace(/:/g, "-")
                  )
                  .replace("{timestamp}", String(Date.now()))
                  .replace("{hostname}", "example.com")
                  .replace("{type}", "recording") + ".webm"
              )
            )
          : null
      ),

      // What to auto-record
      h3({}, "What to capture"),

      div(
        { className: "drm-autorecord-row" },
        label(
          { className: "drm-autorecord-label" },
          input({
            type: "checkbox",
            checked: ar.autoRecordStreams,
            onChange: e =>
              this.onAutoRecordChange("autoRecordStreams", e.target.checked),
          }),
          " Record decrypted video stream (WebM)"
        )
      ),
      ar.autoRecordStreams
        ? div(
            { className: "drm-autorecord-sub" },
            label({}, "Max duration (seconds, 0 = until media ends): "),
            input({
              type: "number",
              className: "drm-autorecord-input drm-autorecord-input--small",
              value: ar.maxRecordingDurationSec,
              min: 0,
              max: 3600,
              onChange: e =>
                this.onAutoRecordChange(
                  "maxRecordingDurationSec",
                  parseInt(e.target.value, 10) || 0
                ),
            }),
            ar.maxRecordingDurationSec === 0
              ? span(
                  { className: "drm-autorecord-hint" },
                  " Records until song/video ends or session closes"
                )
              : null
          )
        : null,

      div(
        { className: "drm-autorecord-row" },
        label(
          { className: "drm-autorecord-label" },
          input({
            type: "checkbox",
            checked: ar.autoRecordFrames,
            onChange: e =>
              this.onAutoRecordChange("autoRecordFrames", e.target.checked),
          }),
          " Capture decoded video frames (PNG)"
        )
      ),
      ar.autoRecordFrames
        ? div(
            { className: "drm-autorecord-sub" },
            label({}, "Frame capture interval (seconds): "),
            input({
              type: "number",
              className: "drm-autorecord-input drm-autorecord-input--small",
              value: ar.frameIntervalSec,
              min: 1,
              max: 60,
              onChange: e =>
                this.onAutoRecordChange(
                  "frameIntervalSec",
                  parseInt(e.target.value, 10) || 5
                ),
            })
          )
        : null,

      div(
        { className: "drm-autorecord-row" },
        label(
          { className: "drm-autorecord-label" },
          input({
            type: "checkbox",
            checked: ar.autoExportLogs,
            onChange: e =>
              this.onAutoRecordChange("autoExportLogs", e.target.checked),
          }),
          " Export session logs (JSON)"
        )
      ),

      // Status
      !ar.outputDir && ar.enabled
        ? div(
            { className: "drm-autorecord-warning" },
            "No output directory set. Auto-record will not save files until a directory is configured."
          )
        : null
    );
  }

  render() {
    return div(
      { className: "drm-config" },
      this.renderAutoRecordConfig(),
      this.renderEMEConfig()
    );
  }
}

function mapStateToProps(state) {
  return {
    config: state.config.list,
    autorecord: state.autorecord,
  };
}

module.exports = connect(mapStateToProps)(ConfigPanel);
