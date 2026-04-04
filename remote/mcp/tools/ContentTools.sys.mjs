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

async function evalInContent(expression) {
  const actor = getActor();
  return actor.evaluateJS(expression);
}

async function evaluateJavaScript(args) {
  const { expression } = args;
  if (!expression) {
    throw new Error("expression is required");
  }
  const result = await evalInContent(expression);
  return [{ type: "text", text: result }];
}

async function getPageContent(args) {
  const { format = "html" } = args;
  let script;
  if (format === "text") {
    script = "document.body?.innerText || ''";
  } else {
    script = "document.documentElement?.outerHTML || ''";
  }
  const result = await evalInContent(script);
  return [{ type: "text", text: result }];
}

async function querySelector(args) {
  const { selector, all = false } = args;
  if (!selector) {
    throw new Error("selector is required");
  }

  let script;
  if (all) {
    script = `
      (() => {
        const els = document.querySelectorAll(${JSON.stringify(selector)});
        return JSON.stringify(Array.from(els).map((el, i) => ({
          index: i,
          tagName: el.tagName?.toLowerCase(),
          id: el.id || undefined,
          className: el.className || undefined,
          textContent: (el.textContent || '').substring(0, 200),
          href: el.href || undefined,
          src: el.src || undefined,
          value: el.value !== undefined ? el.value : undefined,
          attributes: Object.fromEntries(
            Array.from(el.attributes || []).map(a => [a.name, a.value])
          ),
        })));
      })()
    `;
  } else {
    script = `
      (() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return JSON.stringify(null);
        return JSON.stringify({
          tagName: el.tagName?.toLowerCase(),
          id: el.id || undefined,
          className: el.className || undefined,
          textContent: (el.textContent || '').substring(0, 500),
          href: el.href || undefined,
          src: el.src || undefined,
          value: el.value !== undefined ? el.value : undefined,
          innerHTML: (el.innerHTML || '').substring(0, 1000),
          attributes: Object.fromEntries(
            Array.from(el.attributes || []).map(a => [a.name, a.value])
          ),
        });
      })()
    `;
  }

  const result = await evalInContent(script);
  return [{ type: "text", text: result }];
}

async function click(args) {
  const { selector } = args;
  if (!selector) {
    throw new Error("selector is required");
  }

  const script = `
    (() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return 'Element not found: ' + ${JSON.stringify(selector)};
      el.click();
      return 'Clicked element: ' + (el.tagName?.toLowerCase() || 'unknown');
    })()
  `;

  const result = await evalInContent(script);
  return [{ type: "text", text: result }];
}

async function type(args) {
  const { selector, text, clear = false } = args;
  if (!selector) {
    throw new Error("selector is required");
  }
  if (text === undefined) {
    throw new Error("text is required");
  }

  const script = `
    (() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return 'Element not found: ' + ${JSON.stringify(selector)};
      el.focus();
      if (${clear}) {
        el.value = '';
      }
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype, 'value'
      )?.set || Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype, 'value'
      )?.set;
      if (nativeInputValueSetter) {
        nativeInputValueSetter.call(el, ${clear} ? ${JSON.stringify(text)} : el.value + ${JSON.stringify(text)});
      } else {
        el.value = ${clear} ? ${JSON.stringify(text)} : el.value + ${JSON.stringify(text)};
      }
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return 'Typed into element: ' + (el.tagName?.toLowerCase() || 'unknown');
    })()
  `;

  const result = await evalInContent(script);
  return [{ type: "text", text: result }];
}

async function focus(args) {
  const { selector } = args;
  if (!selector) {
    throw new Error("selector is required");
  }

  const script = `
    (() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return 'Element not found';
      el.focus();
      return 'Focused: ' + (el.tagName?.toLowerCase() || 'unknown');
    })()
  `;

  const result = await evalInContent(script);
  return [{ type: "text", text: result }];
}

async function getAttributes(args) {
  const { selector } = args;
  if (!selector) {
    throw new Error("selector is required");
  }

  const script = `
    (() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return JSON.stringify(null);
      return JSON.stringify({
        tagName: el.tagName?.toLowerCase(),
        attributes: Object.fromEntries(
          Array.from(el.attributes || []).map(a => [a.name, a.value])
        ),
        boundingRect: el.getBoundingClientRect()?.toJSON(),
        computedRole: el.computedRole || undefined,
        isVisible: el.checkVisibility?.() ?? true,
      });
    })()
  `;

  const result = await evalInContent(script);
  return [{ type: "text", text: result }];
}

export const ContentTools = {
  tools: [
    {
      name: "page_evaluate",
      description:
        "Evaluate a JavaScript expression in the active tab and return the result",
      inputSchema: {
        type: "object",
        properties: {
          expression: {
            type: "string",
            description: "JavaScript expression to evaluate",
          },
        },
        required: ["expression"],
      },
      handler: evaluateJavaScript,
    },
    {
      name: "page_content",
      description:
        "Get the page content of the active tab as HTML or plain text",
      inputSchema: {
        type: "object",
        properties: {
          format: {
            type: "string",
            enum: ["html", "text"],
            description: "Output format: 'html' or 'text' (default: 'html')",
          },
        },
      },
      handler: getPageContent,
    },
    {
      name: "page_query_selector",
      description: "Find elements matching a CSS selector in the active tab",
      inputSchema: {
        type: "object",
        properties: {
          selector: { type: "string", description: "CSS selector" },
          all: {
            type: "boolean",
            description:
              "If true, return all matching elements; otherwise return only the first match",
          },
        },
        required: ["selector"],
      },
      handler: querySelector,
    },
    {
      name: "page_click",
      description: "Click the first element matching a CSS selector",
      inputSchema: {
        type: "object",
        properties: {
          selector: {
            type: "string",
            description: "CSS selector of the element to click",
          },
        },
        required: ["selector"],
      },
      handler: click,
    },
    {
      name: "page_type",
      description: "Type text into an input element matching a CSS selector",
      inputSchema: {
        type: "object",
        properties: {
          selector: {
            type: "string",
            description: "CSS selector of the input element",
          },
          text: { type: "string", description: "Text to type" },
          clear: {
            type: "boolean",
            description: "Clear the field before typing (default: false)",
          },
        },
        required: ["selector", "text"],
      },
      handler: type,
    },
    {
      name: "page_focus",
      description: "Focus an element matching a CSS selector",
      inputSchema: {
        type: "object",
        properties: {
          selector: {
            type: "string",
            description: "CSS selector of the element to focus",
          },
        },
        required: ["selector"],
      },
      handler: focus,
    },
    {
      name: "page_get_attributes",
      description:
        "Get detailed attributes, bounding rect, and visibility of an element",
      inputSchema: {
        type: "object",
        properties: {
          selector: {
            type: "string",
            description: "CSS selector of the element",
          },
        },
        required: ["selector"],
      },
      handler: getAttributes,
    },
  ],
};
