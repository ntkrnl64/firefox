/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 *
 */
export class McpContentChild extends JSWindowActorChild {
  #dbg = null;
  #breakpoints = new Map();
  #pauseState = null;
  #mutationObserver = null;
  #mutations = [];

  async receiveMessage(msg) {
    switch (msg.name) {
      case "McpContent:evaluateJS":
        return this.#evaluateJS(msg.data);

      // Debugger
      case "McpContent:debuggerAttach":
        return this.#debuggerAttach();
      case "McpContent:debuggerDetach":
        return this.#debuggerDetach();
      case "McpContent:setBreakpoint":
        return this.#setBreakpoint(msg.data);
      case "McpContent:removeBreakpoint":
        return this.#removeBreakpoint(msg.data);
      case "McpContent:listBreakpoints":
        return this.#listBreakpoints();
      case "McpContent:pause":
        return this.#pause();
      case "McpContent:resume":
        return this.#resume();
      case "McpContent:stepOver":
        return this.#step("stepOver");
      case "McpContent:stepInto":
        return this.#step("stepIn");
      case "McpContent:stepOut":
        return this.#step("stepOut");
      case "McpContent:getCallStack":
        return this.#getCallStack();
      case "McpContent:getScopes":
        return this.#getScopes(msg.data);
      case "McpContent:evaluateOnFrame":
        return this.#evaluateOnFrame(msg.data);
      case "McpContent:getPauseState":
        return this.#getPauseState();

      // Mutations
      case "McpContent:watchMutations":
        return this.#watchMutations(msg.data);
      case "McpContent:unwatchMutations":
        return this.#unwatchMutations();
      case "McpContent:getMutations":
        return this.#getMutations();

      default:
        return null;
    }
  }

  #evaluateJS({ expression }) {
    const win = this.contentWindow;
    if (!win) {
      return JSON.stringify({ error: "No content window" });
    }

    try {
      const sandbox = Cu.Sandbox(win, {
        sandboxPrototype: win,
        wantXrays: false,
      });

      const result = Cu.evalInSandbox(
        expression,
        sandbox,
        "1.8",
        "mcp-eval",
        1
      );

      if (result === undefined) {
        return "undefined";
      }
      if (result === null) {
        return "null";
      }
      if (typeof result === "object" || Array.isArray(result)) {
        try {
          return JSON.stringify(result);
        } catch {
          return String(result);
        }
      }
      return String(result);
    } catch (e) {
      return JSON.stringify({ error: e.message, stack: e.stack });
    }
  }

  // -- Debugger --

  #ensureDebugger() {
    if (this.#dbg) {
      return this.#dbg;
    }

    const win = this.contentWindow;
    if (!win) {
      throw new Error("No content window");
    }

    // Use the privileged Debugger API.
    const { addDebuggerToGlobal } = ChromeUtils.importESModule(
      "resource://gre/modules/jsdebugger.sys.mjs"
    );
    const global = Cu.getGlobalForObject({});
    addDebuggerToGlobal(global);

    this.#dbg = new global.Debugger();
    this.#dbg.addDebuggee(win);

    this.#dbg.onDebuggerStatement = frame => {
      return this.#onPause(frame, "debuggerStatement");
    };

    return this.#dbg;
  }

  #debuggerAttach() {
    try {
      this.#ensureDebugger();
      return JSON.stringify({ attached: true });
    } catch (e) {
      return JSON.stringify({ error: e.message });
    }
  }

  #debuggerDetach() {
    if (this.#dbg) {
      this.#dbg.removeAllDebuggees();
      this.#dbg = null;
    }
    this.#pauseState = null;
    this.#breakpoints.clear();
    return JSON.stringify({ detached: true });
  }

  #setBreakpoint({ url, line, column }) {
    const dbg = this.#ensureDebugger();

    const scripts = dbg.findScripts({ url });
    if (!scripts.length) {
      return JSON.stringify({
        error: `No scripts found for ${url}. The script may not be loaded yet.`,
      });
    }

    const id = `${url}:${line}:${column || 0}`;
    const offsets = [];

    for (const script of scripts) {
      const offs = script.getLineOffsets(line);
      for (const offset of offs) {
        script.setBreakpoint(offset, {
          hit(frame) {
            return this.#onPause(frame, "breakpoint", id);
          },
        });
        offsets.push(offset);
      }
    }

    // Also set breakpoint handler on the debugger for scripts not yet loaded.
    if (!this.#dbg.onNewScript) {
      this.#dbg.onNewScript = script => {
        for (const [bpId, bp] of this.#breakpoints) {
          if (script.url === bp.url) {
            const offs = script.getLineOffsets(bp.line);
            for (const offset of offs) {
              script.setBreakpoint(offset, {
                hit: frame => this.#onPause(frame, "breakpoint", bpId),
              });
            }
          }
        }
      };
    }

    this.#breakpoints.set(id, { url, line, column: column || 0, offsets });
    return JSON.stringify({
      id,
      url,
      line,
      scriptsFound: scripts.length,
      offsetsSet: offsets.length,
    });
  }

  #removeBreakpoint({ id }) {
    const bp = this.#breakpoints.get(id);
    if (!bp) {
      return JSON.stringify({ error: "Breakpoint not found" });
    }

    // Clearing breakpoints from scripts would require iterating again;
    // for simplicity we just remove from our tracking.
    this.#breakpoints.delete(id);
    return JSON.stringify({ removed: id });
  }

  #listBreakpoints() {
    const result = [];
    for (const [id, bp] of this.#breakpoints) {
      result.push({ id, url: bp.url, line: bp.line, column: bp.column });
    }
    return JSON.stringify(result);
  }

  #pause() {
    const dbg = this.#ensureDebugger();
    // Request a pause at the next opportunity.
    dbg.onEnterFrame = frame => {
      dbg.onEnterFrame = undefined;
      return this.#onPause(frame, "pause");
    };
    return JSON.stringify({
      message: "Pause requested. Will pause on next JS execution.",
    });
  }

  #onPause(frame, reason, breakpointId) {
    this.#pauseState = {
      reason,
      breakpointId,
      frame,
      url: frame.script?.url,
      line: frame.script?.getOffsetMetadata(frame.offset)?.lineNumber,
      column: frame.script?.getOffsetMetadata(frame.offset)?.columnNumber,
    };

    // Notify parent that we're paused.
    this.sendAsyncMessage("McpContent:paused", {
      reason,
      breakpointId,
      url: this.#pauseState.url,
      line: this.#pauseState.line,
      column: this.#pauseState.column,
    });

    // Enter a nested event loop so we can still receive messages while paused.
    Services.tm.spinEventLoopUntilOrQuit(
      "McpContentChild:debugger-pause",
      () => !this.#pauseState
    );

    return undefined; // Continue execution when loop exits.
  }

  #resume() {
    if (!this.#pauseState) {
      return JSON.stringify({ error: "Not paused" });
    }
    const info = {
      url: this.#pauseState.url,
      line: this.#pauseState.line,
    };
    this.#pauseState = null; // Exits the nested event loop.
    return JSON.stringify({ resumed: true, ...info });
  }

  #step(type) {
    if (!this.#pauseState) {
      return JSON.stringify({ error: "Not paused" });
    }

    const frame = this.#pauseState.frame;
    this.#pauseState = null; // Exit current nested loop.

    // Set up the appropriate step mode.
    const dbg = this.#ensureDebugger();
    switch (type) {
      case "stepOver":
        dbg.onEnterFrame = undefined;
        frame.onStep = () => {
          frame.onStep = undefined;
          return this.#onPause(frame, "step");
        };
        break;
      case "stepIn":
        dbg.onEnterFrame = newFrame => {
          dbg.onEnterFrame = undefined;
          return this.#onPause(newFrame, "step");
        };
        break;
      case "stepOut":
        if (frame.older) {
          frame.older.onStep = () => {
            frame.older.onStep = undefined;
            return this.#onPause(frame.older, "step");
          };
        }
        break;
    }

    return JSON.stringify({ stepping: type });
  }

  #getCallStack() {
    if (!this.#pauseState) {
      return JSON.stringify({ error: "Not paused" });
    }

    const frames = [];
    let frame = this.#pauseState.frame;
    let i = 0;
    while (frame && i < 50) {
      const meta = frame.script?.getOffsetMetadata(frame.offset);
      frames.push({
        index: i,
        type: frame.type,
        displayName: frame.callee?.name || frame.type,
        url: frame.script?.url,
        line: meta?.lineNumber,
        column: meta?.columnNumber,
      });
      frame = frame.older;
      i++;
    }

    return JSON.stringify(frames);
  }

  #getScopes({ frameIndex = 0 }) {
    if (!this.#pauseState) {
      return JSON.stringify({ error: "Not paused" });
    }

    let frame = this.#pauseState.frame;
    for (let i = 0; i < frameIndex && frame; i++) {
      frame = frame.older;
    }
    if (!frame) {
      return JSON.stringify({ error: "Frame not found" });
    }

    const scopes = [];
    let env = frame.environment;
    while (env) {
      const scope = { type: env.type, bindings: {} };
      if (env.type === "declarative" || env.type === "block") {
        try {
          const names = env.names();
          for (const name of names) {
            try {
              const desc = env.getVariable(name);
              let value;
              if (desc === undefined) {
                value = "undefined";
              } else if (desc === null) {
                value = "null";
              } else if (typeof desc === "object" && desc.class) {
                value = `[${desc.class}]`;
              } else {
                value = String(desc).substring(0, 200);
              }
              scope.bindings[name] = value;
            } catch {
              scope.bindings[name] = "<unavailable>";
            }
          }
        } catch {
          // Ignore.
        }
      }
      scopes.push(scope);
      env = env.parent;
    }

    return JSON.stringify(scopes);
  }

  #evaluateOnFrame({ frameIndex = 0, expression }) {
    if (!this.#pauseState) {
      return JSON.stringify({ error: "Not paused" });
    }

    let frame = this.#pauseState.frame;
    for (let i = 0; i < frameIndex && frame; i++) {
      frame = frame.older;
    }
    if (!frame) {
      return JSON.stringify({ error: "Frame not found" });
    }

    try {
      const result = frame.eval(expression);
      if (result.return !== undefined) {
        if (result.return === null) {
          return "null";
        }
        if (typeof result.return === "object" && result.return.class) {
          return `[${result.return.class}]`;
        }
        return String(result.return);
      }
      if (result.throw) {
        return JSON.stringify({ error: String(result.throw) });
      }
      return "undefined";
    } catch (e) {
      return JSON.stringify({ error: e.message });
    }
  }

  #getPauseState() {
    if (!this.#pauseState) {
      return JSON.stringify({ paused: false });
    }
    return JSON.stringify({
      paused: true,
      reason: this.#pauseState.reason,
      breakpointId: this.#pauseState.breakpointId,
      url: this.#pauseState.url,
      line: this.#pauseState.line,
      column: this.#pauseState.column,
    });
  }

  // -- Mutation observer --

  #watchMutations({
    selector,
    subtree = true,
    attributes = true,
    childList = true,
    characterData = false,
  }) {
    this.#unwatchMutations();

    const win = this.contentWindow;
    if (!win) {
      return JSON.stringify({ error: "No content window" });
    }

    const target = selector
      ? win.document.querySelector(selector)
      : win.document.body;

    if (!target) {
      return JSON.stringify({ error: "Target element not found" });
    }

    this.#mutations = [];
    this.#mutationObserver = new win.MutationObserver(mutations => {
      for (const m of mutations) {
        if (this.#mutations.length >= 500) {
          break;
        }
        const entry = {
          type: m.type,
          target: {
            tag: m.target.tagName?.toLowerCase(),
            id: m.target.id || undefined,
            className: (typeof m.target.className === "string"
              ? m.target.className
              : ""
            ).substring(0, 100),
          },
          timestamp: Date.now(),
        };
        if (m.type === "attributes") {
          entry.attributeName = m.attributeName;
          entry.oldValue = m.oldValue?.substring(0, 200);
          entry.newValue = m.target
            .getAttribute(m.attributeName)
            ?.substring(0, 200);
        } else if (m.type === "childList") {
          entry.addedNodes = m.addedNodes.length;
          entry.removedNodes = m.removedNodes.length;
        } else if (m.type === "characterData") {
          entry.oldValue = m.oldValue?.substring(0, 200);
          entry.newValue = m.target.textContent?.substring(0, 200);
        }
        this.#mutations.push(entry);
      }
    });

    this.#mutationObserver.observe(target, {
      subtree,
      attributes,
      childList,
      characterData,
      attributeOldValue: attributes,
      characterDataOldValue: characterData,
    });

    return JSON.stringify({
      watching: true,
      target: selector || "document.body",
    });
  }

  #unwatchMutations() {
    if (this.#mutationObserver) {
      this.#mutationObserver.disconnect();
      this.#mutationObserver = null;
    }
    return JSON.stringify({ watching: false });
  }

  #getMutations() {
    const result = this.#mutations.slice();
    this.#mutations.length = 0;
    return JSON.stringify(result);
  }
}
