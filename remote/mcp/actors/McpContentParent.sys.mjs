/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 *
 */
export class McpContentParent extends JSWindowActorParent {
  evaluateJS(expression) {
    return this.sendQuery("McpContent:evaluateJS", { expression });
  }

  // Debugger
  debuggerAttach() {
    return this.sendQuery("McpContent:debuggerAttach");
  }
  debuggerDetach() {
    return this.sendQuery("McpContent:debuggerDetach");
  }
  setBreakpoint(url, line, column) {
    return this.sendQuery("McpContent:setBreakpoint", { url, line, column });
  }
  removeBreakpoint(id) {
    return this.sendQuery("McpContent:removeBreakpoint", { id });
  }
  listBreakpoints() {
    return this.sendQuery("McpContent:listBreakpoints");
  }
  pause() {
    return this.sendQuery("McpContent:pause");
  }
  resume() {
    return this.sendQuery("McpContent:resume");
  }
  stepOver() {
    return this.sendQuery("McpContent:stepOver");
  }
  stepInto() {
    return this.sendQuery("McpContent:stepInto");
  }
  stepOut() {
    return this.sendQuery("McpContent:stepOut");
  }
  getCallStack() {
    return this.sendQuery("McpContent:getCallStack");
  }
  getScopes(frameIndex) {
    return this.sendQuery("McpContent:getScopes", { frameIndex });
  }
  evaluateOnFrame(frameIndex, expression) {
    return this.sendQuery("McpContent:evaluateOnFrame", {
      frameIndex,
      expression,
    });
  }
  getPauseState() {
    return this.sendQuery("McpContent:getPauseState");
  }

  // Mutations
  watchMutations(options) {
    return this.sendQuery("McpContent:watchMutations", options);
  }
  unwatchMutations() {
    return this.sendQuery("McpContent:unwatchMutations");
  }
  getMutations() {
    return this.sendQuery("McpContent:getMutations");
  }

  receiveMessage(msg) {
    switch (msg.name) {
      case "McpContent:paused":
        // Debugger paused notification from content process.
        // Could be used for SSE notifications in the future.
        break;
    }
  }
}

let registered = false;

export function registerMcpContentActor() {
  if (registered) {
    return;
  }

  try {
    ChromeUtils.registerWindowActor("McpContent", {
      kind: "JSWindowActor",
      parent: {
        esModuleURI:
          "chrome://remote/content/mcp/actors/McpContentParent.sys.mjs",
      },
      child: {
        esModuleURI:
          "chrome://remote/content/mcp/actors/McpContentChild.sys.mjs",
      },
      allFrames: true,
      includeChrome: false,
    });
    registered = true;
  } catch (e) {
    if (e.name !== "NotSupportedError") {
      throw e;
    }
  }
}

export function unregisterMcpContentActor() {
  if (!registered) {
    return;
  }

  try {
    ChromeUtils.unregisterWindowActor("McpContent");
  } catch {
    // Ignore if already unregistered.
  }
  registered = false;
}
