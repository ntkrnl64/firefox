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
  h4,
  table,
  thead,
  tbody,
  tr,
  th,
  td,
  span,
  pre,
  code,
  details,
  summary,
  ul,
  li,
  button,
  img,
} = require("resource://devtools/client/shared/vendor/react-dom-factories.js");

const STATUS_CLASSES = {
  usable: "drm-badge--success",
  expired: "drm-badge--warning",
  released: "drm-badge--warning",
  "output-restricted": "drm-badge--error",
  "output-downscaled": "drm-badge--error",
  "status-pending": "drm-badge--info",
  "internal-error": "drm-badge--error",
};

class SessionsPanel extends Component {
  static get propTypes() {
    return {
      sessions: PropTypes.array.isRequired,
    };
  }

  constructor(props) {
    super(props);
    this.state = {
      capturedFrames: {},
      mediaStates: {},
      recordings: {},
      busy: {},
    };
  }

  async onCaptureFrame(sessionId) {
    this.setState({
      busy: { ...this.state.busy, [sessionId + "_frame"]: true },
    });
    try {
      const result = await window.DrmApp.captureVideoFrame(sessionId);
      this.setState({
        capturedFrames: { ...this.state.capturedFrames, [sessionId]: result },
        busy: { ...this.state.busy, [sessionId + "_frame"]: false },
      });
    } catch {
      this.setState({
        busy: { ...this.state.busy, [sessionId + "_frame"]: false },
      });
    }
  }

  async onRefreshMediaState(sessionId) {
    try {
      const result = await window.DrmApp.getSessionMediaState(sessionId);
      this.setState({
        mediaStates: { ...this.state.mediaStates, [sessionId]: result },
      });
    } catch {
      // Ignore
    }
  }

  async onDeepDebug(sessionId) {
    this.setState({
      busy: { ...this.state.busy, [sessionId + "_deep"]: true },
    });
    try {
      const result = await window.DrmApp.getSessionDeepDebug(sessionId);
      this.setState({
        mediaStates: {
          ...this.state.mediaStates,
          [sessionId + "_deep"]: result,
        },
        busy: { ...this.state.busy, [sessionId + "_deep"]: false },
      });
    } catch {
      this.setState({
        busy: { ...this.state.busy, [sessionId + "_deep"]: false },
      });
    }
  }

  async onToggleRecording(sessionId) {
    const isRecording = this.state.recordings[sessionId]?.active;
    this.setState({ busy: { ...this.state.busy, [sessionId + "_rec"]: true } });
    try {
      if (isRecording) {
        const result = await window.DrmApp.stopStreamRecording(sessionId);
        this.setState({
          recordings: {
            ...this.state.recordings,
            [sessionId]: { active: false, result },
          },
          busy: { ...this.state.busy, [sessionId + "_rec"]: false },
        });
      } else {
        const result = await window.DrmApp.startStreamRecording(sessionId);
        if (result.error) {
          this.setState({
            recordings: {
              ...this.state.recordings,
              [sessionId]: { active: false, result },
            },
            busy: { ...this.state.busy, [sessionId + "_rec"]: false },
          });
        } else {
          this.setState({
            recordings: {
              ...this.state.recordings,
              [sessionId]: { active: true, result },
            },
            busy: { ...this.state.busy, [sessionId + "_rec"]: false },
          });
        }
      }
    } catch {
      this.setState({
        busy: { ...this.state.busy, [sessionId + "_rec"]: false },
      });
    }
  }

  async onSaveFrame(sessionId) {
    const frame = this.state.capturedFrames[sessionId];
    if (frame?.dataUrl) {
      const name =
        "drm-frame-" + sessionId + "-" + frame.currentTime.toFixed(3) + "s.png";
      await window.DrmApp.saveDataUrlToFile(frame.dataUrl, name);
    }
  }

  async onSaveRecording(sessionId) {
    const rec = this.state.recordings[sessionId];
    if (rec?.result?.dataUrl) {
      const ext = rec.result.mimeType?.includes("webm") ? "webm" : "mp4";
      const name = "drm-recording-" + sessionId + "." + ext;
      await window.DrmApp.saveDataUrlToFile(rec.result.dataUrl, name);
    }
  }

  fmtTime(ts) {
    const d = new Date(ts);
    return (
      d.toLocaleTimeString() +
      "." +
      String(d.getMilliseconds()).padStart(3, "0")
    );
  }

  fmtDuration(ms) {
    if (ms === null || ms === undefined) {
      return "N/A";
    }
    if (ms < 1000) {
      return ms + "ms";
    }
    return (ms / 1000).toFixed(2) + "s";
  }

  fmtBytes(n) {
    if (!n) {
      return "0 B";
    }
    if (n < 1024) {
      return n + " B";
    }
    if (n < 1024 * 1024) {
      return (n / 1024).toFixed(1) + " KB";
    }
    return (n / (1024 * 1024)).toFixed(2) + " MB";
  }

  renderKeyStatuses(keyStatuses) {
    if (!keyStatuses || keyStatuses.length === 0) {
      return div({ className: "drm-empty" }, "No key statuses available");
    }

    return table(
      { className: "drm-table drm-table--compact" },
      thead({}, tr({}, th({}, "Key ID"), th({}, "Status"))),
      tbody(
        {},
        keyStatuses.map((ks, i) =>
          tr(
            { key: i },
            td({}, span({ className: "drm-mono" }, ks.keyId)),
            td(
              {},
              span(
                {
                  className:
                    "drm-badge " +
                    (STATUS_CLASSES[ks.status] || "drm-badge--info"),
                },
                ks.status
              )
            )
          )
        )
      )
    );
  }

  renderKeyStatusHistory(history) {
    if (!history || history.length === 0) {
      return null;
    }
    return details(
      { className: "drm-session-section" },
      summary(
        { className: "drm-session-section__title" },
        "Key Status History (" + history.length + " changes)"
      ),
      div(
        { className: "drm-timeline" },
        history.map((entry, i) =>
          div(
            { key: i, className: "drm-timeline__entry" },
            span(
              { className: "drm-mono drm-timeline__time" },
              this.fmtTime(entry.timestamp)
            ),
            div(
              { className: "drm-timeline__detail" },
              entry.changes && entry.changes.length
                ? entry.changes.map((c, j) =>
                    div(
                      { key: j },
                      span(
                        { className: "drm-mono" },
                        c.keyId.substring(0, 16) + "..."
                      ),
                      ": ",
                      span(
                        {
                          className:
                            "drm-badge " +
                            (STATUS_CLASSES[c.from] || "drm-badge--info"),
                        },
                        c.from
                      ),
                      " -> ",
                      span(
                        {
                          className:
                            "drm-badge " +
                            (STATUS_CLASSES[c.to] || "drm-badge--info"),
                        },
                        c.to
                      )
                    )
                  )
                : span({}, entry.statuses.length + " key(s), no changes")
            )
          )
        )
      )
    );
  }

  renderLicenseExchanges(exchanges) {
    if (!exchanges || exchanges.length === 0) {
      return null;
    }
    return details(
      { className: "drm-session-section" },
      summary(
        { className: "drm-session-section__title" },
        "License Exchanges (" + exchanges.length + ")"
      ),
      div(
        { className: "drm-license-exchanges" },
        exchanges.map((ex, i) =>
          div(
            { key: i, className: "drm-license-exchange" },
            div(
              { className: "drm-license-exchange__header" },
              span({ className: "drm-mono" }, this.fmtTime(ex.timestamp)),
              " ",
              span(
                { className: "drm-badge drm-badge--info" },
                ex.direction === "request"
                  ? ex.messageType || "request"
                  : "response"
              ),
              " ",
              span({}, this.fmtBytes(ex.responseSize || ex.messageSize || 0)),
              ex.durationMs !== null && ex.durationMs !== undefined
                ? span({ className: "drm-mono" }, " (" + ex.durationMs + "ms)")
                : null,
              this.renderAcceptedBadge(ex.accepted)
            ),
            ex.parsedMessage || ex.parsedResponse
              ? details(
                  {},
                  summary({}, "Parsed Data"),
                  pre(
                    { className: "drm-event-detail__json" },
                    code(
                      {},
                      JSON.stringify(
                        ex.parsedMessage || ex.parsedResponse,
                        null,
                        2
                      )
                    )
                  )
                )
              : null,
            ex.messageBase64 || ex.responseBase64
              ? details(
                  {},
                  summary({}, "Raw Data (Base64)"),
                  pre(
                    { className: "drm-event-detail__hex" },
                    code({}, ex.messageBase64 || ex.responseBase64)
                  )
                )
              : null,
            ex.error
              ? div(
                  { className: "drm-error-item__header" },
                  span(
                    { className: "drm-badge drm-badge--error" },
                    ex.error.name + ": " + ex.error.message
                  )
                )
              : null
          )
        )
      )
    );
  }

  renderParsedInitData(parsed) {
    if (!parsed) {
      return null;
    }
    if (parsed.type === "cenc" && parsed.psshBoxes) {
      return div(
        {},
        h4({}, "PSSH Boxes (" + parsed.psshBoxes.length + ")"),
        parsed.psshBoxes.map((box, i) =>
          div(
            { key: i, className: "drm-pssh-box" },
            div(
              {},
              span({ className: "drm-badge drm-badge--info" }, box.systemName),
              " v",
              box.version,
              " (",
              box.boxSize,
              " bytes)"
            ),
            div(
              {},
              "System ID: ",
              span({ className: "drm-mono" }, box.systemId)
            ),
            box.keyIds && box.keyIds.length
              ? div(
                  {},
                  "Key IDs: ",
                  box.keyIds.map((kid, j) =>
                    div({ key: j }, span({ className: "drm-mono" }, kid))
                  )
                )
              : null,
            box.data
              ? div({}, "Data: ", span({ className: "drm-mono" }, box.data))
              : null
          )
        )
      );
    }
    if (parsed.type === "keyids" && parsed.content) {
      return pre(
        { className: "drm-event-detail__json" },
        code({}, JSON.stringify(parsed.content, null, 2))
      );
    }
    if (parsed.type === "webm") {
      return div(
        {},
        "WebM Key ID: ",
        span({ className: "drm-mono" }, parsed.keyIdHex)
      );
    }
    return pre(
      { className: "drm-event-detail__json" },
      code({}, JSON.stringify(parsed, null, 2))
    );
  }

  renderInitData(session) {
    if (!session.initDataType && !session.initDataHex) {
      return null;
    }
    return details(
      { className: "drm-session-section" },
      summary({ className: "drm-session-section__title" }, "Init Data"),
      div(
        { className: "drm-session-section__body" },
        div(
          {},
          "Type: ",
          span({ className: "drm-mono" }, session.initDataType || "N/A")
        ),
        div(
          {},
          "Size: ",
          span({ className: "drm-mono" }, this.fmtBytes(session.initDataSize))
        ),
        session.parsedInitData
          ? this.renderParsedInitData(session.parsedInitData)
          : null,
        session.initDataHex
          ? details(
              {},
              summary({}, "Raw Hex"),
              pre(
                { className: "drm-event-detail__hex" },
                code({}, session.initDataHex)
              )
            )
          : null
      )
    );
  }

  renderErrors(errors) {
    if (!errors || errors.length === 0) {
      return null;
    }
    return details(
      { className: "drm-session-section" },
      summary(
        { className: "drm-session-section__title" },
        span(
          { className: "drm-badge drm-badge--error" },
          "Errors (" + errors.length + ")"
        )
      ),
      ul(
        { className: "drm-error-list" },
        errors.map((err, i) =>
          li(
            { key: i, className: "drm-error-item" },
            div(
              { className: "drm-error-item__header" },
              span({ className: "drm-mono" }, this.fmtTime(err.timestamp)),
              " ",
              span({ className: "drm-error-item__type" }, err.type),
              " - ",
              err.name,
              ": ",
              err.message,
              err.systemCode
                ? span(
                    { className: "drm-mono" },
                    " (code: " + err.systemCode + ")"
                  )
                : null
            ),
            err.stack
              ? pre(
                  { className: "drm-event-detail__stack" },
                  code({}, err.stack)
                )
              : null
          )
        )
      )
    );
  }

  renderStackTraces(session) {
    if (!session.createdStack && !session.generateRequestStack) {
      return null;
    }
    return details(
      { className: "drm-session-section" },
      summary({ className: "drm-session-section__title" }, "Stack Traces"),
      session.createdStack
        ? div(
            { className: "drm-session-section__body" },
            h4({}, "createSession()"),
            pre(
              { className: "drm-event-detail__stack" },
              code({}, session.createdStack)
            )
          )
        : null,
      session.generateRequestStack
        ? div(
            { className: "drm-session-section__body" },
            h4({}, "generateRequest()"),
            pre(
              { className: "drm-event-detail__stack" },
              code({}, session.generateRequestStack)
            )
          )
        : null
    );
  }

  renderTimeline(timeline) {
    if (!timeline || timeline.length === 0) {
      return null;
    }
    return details(
      { className: "drm-session-section" },
      summary(
        { className: "drm-session-section__title" },
        "Timeline (" + timeline.length + " events)"
      ),
      div(
        { className: "drm-timeline" },
        timeline.map((event, i) =>
          div(
            { key: i, className: "drm-timeline__entry" },
            span(
              { className: "drm-mono drm-timeline__time" },
              this.fmtTime(event.timestamp)
            ),
            span({ className: "drm-timeline__action" }, event.action),
            event.detail
              ? span({ className: "drm-timeline__detail" }, event.detail)
              : null
          )
        )
      )
    );
  }

  renderSession(session) {
    const expiration =
      session.expiration === Infinity || !isFinite(session.expiration)
        ? "N/A"
        : new Date(session.expiration).toLocaleString();

    const timeToKey =
      session.firstKeyUsableAt && session.createdAt
        ? session.firstKeyUsableAt - session.createdAt
        : null;

    let lifetime = null;
    if (session.closedAt && session.createdAt) {
      lifetime = session.closedAt - session.createdAt;
    } else if (session.createdAt) {
      lifetime = Date.now() - session.createdAt;
    }

    return div(
      { key: session.sessionId, className: "drm-session-card" },
      div(
        { className: "drm-session-card__header" },
        h3({}, "Session: " + session.sessionId),
        div(
          { className: "drm-session-card__badges" },
          session.closed
            ? span(
                { className: "drm-badge drm-badge--warning" },
                "Closed" +
                  (session.closedReason
                    ? " (" + session.closedReason + ")"
                    : "")
              )
            : span({ className: "drm-badge drm-badge--success" }, "Active"),
          session.errors && session.errors.length
            ? span(
                { className: "drm-badge drm-badge--error" },
                session.errors.length + " error(s)"
              )
            : null
        )
      ),
      div(
        { className: "drm-session-card__meta" },
        div({}, "Type: ", span({ className: "drm-mono" }, session.sessionType)),
        session.keySystem
          ? div(
              {},
              "Key System: ",
              span({ className: "drm-mono" }, session.keySystem)
            )
          : null,
        div({}, "Expiration: ", span({ className: "drm-mono" }, expiration)),
        div(
          {},
          "Messages: ",
          span({ className: "drm-mono" }, String(session.messageCount)),
          session.lastMessageType
            ? span(
                {},
                " (last: " +
                  session.lastMessageType +
                  ", " +
                  this.fmtBytes(session.lastMessageSize) +
                  ")"
              )
            : null
        ),
        div(
          {},
          "Data sent: ",
          span(
            { className: "drm-mono" },
            this.fmtBytes(session.totalBytesSent)
          ),
          ", received: ",
          span(
            { className: "drm-mono" },
            this.fmtBytes(session.totalBytesReceived)
          )
        ),
        timeToKey !== null
          ? div(
              {},
              "Time to first usable key: ",
              span(
                { className: "drm-mono drm-badge drm-badge--success" },
                this.fmtDuration(timeToKey)
              )
            )
          : null,
        lifetime !== null
          ? div(
              {},
              "Session lifetime: ",
              span({ className: "drm-mono" }, this.fmtDuration(lifetime))
            )
          : null,
        session.mediaElementInfo
          ? div(
              {},
              "Media: ",
              span(
                { className: "drm-mono" },
                "<" +
                  session.mediaElementInfo.tagName +
                  "> " +
                  (session.mediaElementInfo.videoWidth
                    ? session.mediaElementInfo.videoWidth +
                      "x" +
                      session.mediaElementInfo.videoHeight +
                      " "
                    : "") +
                  (session.mediaElementInfo.src || "")
              )
            )
          : null
      ),
      div(
        { className: "drm-session-card__body" },
        this.renderMediaExport(session),
        h4({}, "Key Statuses"),
        this.renderKeyStatuses(session.keyStatuses),
        this.renderErrors(session.errors),
        this.renderInitData(session),
        this.renderLicenseExchanges(session.licenseExchanges),
        this.renderKeyStatusHistory(session.keyStatusHistory),
        this.renderStackTraces(session),
        this.renderTimeline(session.timeline)
      )
    );
  }

  renderAcceptedBadge(accepted) {
    if (accepted === true) {
      return span({ className: "drm-badge drm-badge--success" }, "accepted");
    }
    if (accepted === false) {
      return span({ className: "drm-badge drm-badge--error" }, "rejected");
    }
    return null;
  }

  renderFrameResult(frame) {
    if (!frame) {
      return null;
    }
    if (frame.error) {
      return div({ className: "drm-export-error" }, frame.error);
    }
    return div(
      { className: "drm-export-frame" },
      img({
        src: frame.dataUrl,
        className: "drm-export-frame__img",
        alt: "Captured frame",
      }),
      div(
        { className: "drm-export-frame__info" },
        span({}, frame.width + "x" + frame.height),
        " at ",
        span({ className: "drm-mono" }, frame.currentTime.toFixed(3) + "s"),
        " ",
        frame.isBlackFrame
          ? span(
              { className: "drm-badge drm-badge--error" },
              "BLACK FRAME - decryption may have failed"
            )
          : span(
              { className: "drm-badge drm-badge--success" },
              "Frame OK (avg brightness: " + frame.avgBrightness + ")"
            )
      )
    );
  }

  renderRecordButtonLabel(recBusy, rec) {
    if (recBusy) {
      return "...";
    }
    if (rec?.active) {
      return "Stop Recording";
    }
    return "Start Recording";
  }

  renderRecordingResult(rec) {
    if (!rec || rec.active || !rec.result) {
      return null;
    }
    if (rec.result.error) {
      return div({ className: "drm-export-error" }, rec.result.error);
    }
    if (rec.result.warning) {
      return div({ className: "drm-export-error" }, rec.result.warning);
    }
    return div(
      { className: "drm-export-recording-result" },
      span({ className: "drm-badge drm-badge--success" }, "Done"),
      " ",
      this.fmtDuration(rec.result.durationMs) +
        ", " +
        this.fmtBytes(rec.result.dataSize) +
        " (" +
        rec.result.mimeType +
        ")"
    );
  }

  renderMediaStateOutput(mediaState) {
    if (!mediaState) {
      return null;
    }
    if (mediaState.error) {
      return div({ className: "drm-export-error" }, mediaState.error);
    }
    return pre(
      { className: "drm-event-detail__json" },
      code({}, JSON.stringify(mediaState, null, 2))
    );
  }

  renderFrameCapture(sid, frame, frameBusy, session) {
    return div(
      { className: "drm-export-group" },
      h4({}, "Frame Capture"),
      div(
        { className: "drm-export-group__desc" },
        "Grab the current decoded video frame. A non-black frame proves decryption is working."
      ),
      div(
        { className: "drm-export-group__actions" },
        button(
          {
            className: "drm-button",
            disabled: frameBusy || session.closed,
            onClick: () => this.onCaptureFrame(sid),
          },
          frameBusy ? "Capturing..." : "Capture Frame"
        ),
        frame && frame.dataUrl
          ? button(
              {
                className: "drm-button",
                onClick: () => this.onSaveFrame(sid),
              },
              "Save PNG"
            )
          : null
      ),
      this.renderFrameResult(frame)
    );
  }

  renderStreamRecording(sid, rec, recBusy, session) {
    return div(
      { className: "drm-export-group" },
      h4({}, "Stream Recording"),
      div(
        { className: "drm-export-group__desc" },
        "Record the decrypted video/audio output as a WebM file. " +
          "This captures what the browser decoded after decryption."
      ),
      div(
        { className: "drm-export-group__actions" },
        button(
          {
            className: rec?.active
              ? "drm-button drm-button--recording"
              : "drm-button",
            disabled: recBusy || session.closed,
            onClick: () => this.onToggleRecording(sid),
          },
          this.renderRecordButtonLabel(recBusy, rec)
        ),
        rec && !rec.active && rec.result?.dataUrl
          ? button(
              {
                className: "drm-button",
                onClick: () => this.onSaveRecording(sid),
              },
              "Save Recording"
            )
          : null
      ),
      rec?.active
        ? div(
            { className: "drm-export-recording-active" },
            span({ className: "drm-badge drm-badge--error" }, "REC"),
            " Recording decrypted stream (" +
              (rec.result?.mimeType || "") +
              ")..."
          )
        : null,
      this.renderRecordingResult(rec)
    );
  }

  renderLiveMediaState(sid, mediaState) {
    return div(
      { className: "drm-export-group" },
      h4({}, "Live Media State"),
      div(
        { className: "drm-export-group__actions" },
        button(
          {
            className: "drm-button",
            onClick: () => this.onRefreshMediaState(sid),
          },
          "Refresh State"
        ),
        button(
          {
            className: "drm-button",
            disabled: this.state.busy[sid + "_deep"],
            onClick: () => this.onDeepDebug(sid),
          },
          this.state.busy[sid + "_deep"] ? "Loading..." : "Deep Debug"
        )
      ),
      this.renderMediaStateOutput(mediaState),
      this.state.mediaStates[sid + "_deep"]
        ? div(
            {},
            h4({}, "Deep Debug Info"),
            div(
              { className: "drm-export-group__desc" },
              "Decoder pipeline, HW acceleration, frame stats, waitingForKey state, " +
                "buffering, state machine, MediaSource demuxer, cache — from mozRequestDebugInfo"
            ),
            pre(
              { className: "drm-event-detail__json" },
              code(
                {},
                JSON.stringify(this.state.mediaStates[sid + "_deep"], null, 2)
              )
            )
          )
        : null
    );
  }

  renderMediaExport(session) {
    const sid = session.sessionId;
    const frame = this.state.capturedFrames[sid];
    const mediaState = this.state.mediaStates[sid];
    const rec = this.state.recordings[sid];
    const frameBusy = this.state.busy[sid + "_frame"];
    const recBusy = this.state.busy[sid + "_rec"];

    return details(
      {
        className: "drm-session-section drm-session-section--export",
        open: true,
      },
      summary(
        { className: "drm-session-section__title" },
        "Decrypted Media Export"
      ),
      div(
        { className: "drm-disclaimer drm-disclaimer--inline" },
        "Captured media is decrypted output intended for verifying your DRM " +
          "integration works correctly. Do not redistribute protected content. " +
          "For developer/QA testing only."
      ),
      div(
        { className: "drm-export-toolbar" },
        this.renderFrameCapture(sid, frame, frameBusy, session),
        this.renderStreamRecording(sid, rec, recBusy, session),
        this.renderLiveMediaState(sid, mediaState)
      )
    );
  }

  render() {
    const { sessions } = this.props;

    if (sessions.length === 0) {
      return div(
        { className: "drm-sessions" },
        h2({}, "Active Sessions"),
        div(
          { className: "drm-empty" },
          "No active DRM sessions detected. Navigate to a page with encrypted media to see sessions."
        )
      );
    }

    return div(
      { className: "drm-sessions" },
      h2({}, "Active Sessions (" + sessions.length + ")"),
      sessions.map(s => this.renderSession(s))
    );
  }
}

function mapStateToProps(state) {
  return { sessions: state.sessions.list };
}

module.exports = connect(mapStateToProps)(SessionsPanel);
