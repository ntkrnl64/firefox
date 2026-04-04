/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

function getActor() {
  const win = Services.wm.getMostRecentBrowserWindow();
  if (!win?.gBrowser) {
    throw new Error("No browser window available");
  }
  const browser = win.gBrowser.selectedBrowser;
  const bc = browser?.browsingContext;
  if (!bc?.currentWindowGlobal) {
    throw new Error("No active browsing context");
  }
  return bc.currentWindowGlobal.getActor("McpContent");
}

async function attach() {
  const result = await getActor().debuggerAttach();
  return [{ type: "text", text: result }];
}

async function detach() {
  const result = await getActor().debuggerDetach();
  return [{ type: "text", text: result }];
}

async function setBreakpoint(args) {
  const { url, line, column } = args;
  if (!url || !line) {
    throw new Error("url and line are required");
  }
  const result = await getActor().setBreakpoint(url, line, column);
  return [{ type: "text", text: result }];
}

async function removeBreakpoint(args) {
  const { id } = args;
  if (!id) {
    throw new Error("id is required");
  }
  const result = await getActor().removeBreakpoint(id);
  return [{ type: "text", text: result }];
}

async function listBreakpoints() {
  const result = await getActor().listBreakpoints();
  return [{ type: "text", text: result }];
}

async function pause() {
  const result = await getActor().pause();
  return [{ type: "text", text: result }];
}

async function resume() {
  const result = await getActor().resume();
  return [{ type: "text", text: result }];
}

async function stepOver() {
  const result = await getActor().stepOver();
  return [{ type: "text", text: result }];
}

async function stepInto() {
  const result = await getActor().stepInto();
  return [{ type: "text", text: result }];
}

async function stepOut() {
  const result = await getActor().stepOut();
  return [{ type: "text", text: result }];
}

async function getCallStack() {
  const result = await getActor().getCallStack();
  return [{ type: "text", text: result }];
}

async function getScopes(args) {
  const { frameIndex = 0 } = args;
  const result = await getActor().getScopes(frameIndex);
  return [{ type: "text", text: result }];
}

async function evaluateOnFrame(args) {
  const { expression, frameIndex = 0 } = args;
  if (!expression) {
    throw new Error("expression is required");
  }
  const result = await getActor().evaluateOnFrame(frameIndex, expression);
  return [{ type: "text", text: result }];
}

async function getPauseState() {
  const result = await getActor().getPauseState();
  return [{ type: "text", text: result }];
}

async function watchMutations(args) {
  const {
    selector,
    subtree = true,
    attributes = true,
    childList = true,
    characterData = false,
  } = args;
  const result = await getActor().watchMutations({
    selector,
    subtree,
    attributes,
    childList,
    characterData,
  });
  return [{ type: "text", text: result }];
}

async function unwatchMutations() {
  const result = await getActor().unwatchMutations();
  return [{ type: "text", text: result }];
}

async function getMutations() {
  const result = await getActor().getMutations();
  return [{ type: "text", text: result }];
}

export const DebuggerTools = {
  tools: [
    {
      name: "debugger_attach",
      description:
        "Attach the JS debugger to the active tab. Required before setting breakpoints.",
      inputSchema: { type: "object", properties: {} },
      handler: attach,
    },
    {
      name: "debugger_detach",
      description: "Detach the JS debugger and remove all breakpoints",
      inputSchema: { type: "object", properties: {} },
      handler: detach,
    },
    {
      name: "debugger_set_breakpoint",
      description: "Set a breakpoint at a specific script URL and line number",
      inputSchema: {
        type: "object",
        properties: {
          url: {
            type: "string",
            description: "Script URL (use inspect_scripts to find URLs)",
          },
          line: { type: "integer", description: "Line number" },
          column: { type: "integer", description: "Column number (optional)" },
        },
        required: ["url", "line"],
      },
      handler: setBreakpoint,
    },
    {
      name: "debugger_remove_breakpoint",
      description: "Remove a breakpoint by ID",
      inputSchema: {
        type: "object",
        properties: {
          id: {
            type: "string",
            description: "Breakpoint ID (url:line:column)",
          },
        },
        required: ["id"],
      },
      handler: removeBreakpoint,
    },
    {
      name: "debugger_list_breakpoints",
      description: "List all active breakpoints",
      inputSchema: { type: "object", properties: {} },
      handler: listBreakpoints,
    },
    {
      name: "debugger_pause",
      description: "Request a pause at the next JS execution",
      inputSchema: { type: "object", properties: {} },
      handler: pause,
    },
    {
      name: "debugger_resume",
      description: "Resume execution after a pause",
      inputSchema: { type: "object", properties: {} },
      handler: resume,
    },
    {
      name: "debugger_step_over",
      description: "Step over the current statement (while paused)",
      inputSchema: { type: "object", properties: {} },
      handler: stepOver,
    },
    {
      name: "debugger_step_into",
      description: "Step into the current function call (while paused)",
      inputSchema: { type: "object", properties: {} },
      handler: stepInto,
    },
    {
      name: "debugger_step_out",
      description: "Step out of the current function (while paused)",
      inputSchema: { type: "object", properties: {} },
      handler: stepOut,
    },
    {
      name: "debugger_call_stack",
      description: "Get the call stack when paused",
      inputSchema: { type: "object", properties: {} },
      handler: getCallStack,
    },
    {
      name: "debugger_scopes",
      description: "Get variable scopes for a stack frame when paused",
      inputSchema: {
        type: "object",
        properties: {
          frameIndex: {
            type: "integer",
            description: "Stack frame index (default: 0 = current)",
          },
        },
      },
      handler: getScopes,
    },
    {
      name: "debugger_evaluate",
      description:
        "Evaluate an expression in the context of a stack frame when paused",
      inputSchema: {
        type: "object",
        properties: {
          expression: { type: "string", description: "Expression to evaluate" },
          frameIndex: {
            type: "integer",
            description: "Stack frame index (default: 0 = current)",
          },
        },
        required: ["expression"],
      },
      handler: evaluateOnFrame,
    },
    {
      name: "debugger_pause_state",
      description: "Check if the debugger is currently paused and why",
      inputSchema: { type: "object", properties: {} },
      handler: getPauseState,
    },
    {
      name: "dom_watch_mutations",
      description:
        "Start watching for DOM mutations (attribute changes, added/removed nodes)",
      inputSchema: {
        type: "object",
        properties: {
          selector: {
            type: "string",
            description:
              "CSS selector of element to watch (default: document.body)",
          },
          subtree: {
            type: "boolean",
            description: "Watch descendants too (default: true)",
          },
          attributes: {
            type: "boolean",
            description: "Watch attribute changes (default: true)",
          },
          childList: {
            type: "boolean",
            description: "Watch added/removed children (default: true)",
          },
          characterData: {
            type: "boolean",
            description: "Watch text content changes (default: false)",
          },
        },
      },
      handler: watchMutations,
    },
    {
      name: "dom_unwatch_mutations",
      description: "Stop watching for DOM mutations",
      inputSchema: { type: "object", properties: {} },
      handler: unwatchMutations,
    },
    {
      name: "dom_get_mutations",
      description:
        "Get captured DOM mutations since last call (clears the buffer)",
      inputSchema: { type: "object", properties: {} },
      handler: getMutations,
    },
  ],
};
