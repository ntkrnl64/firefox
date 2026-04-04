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
  return getActor().evaluateJS(expression);
}

async function setAttribute(args) {
  const { selector, name, value } = args;
  if (!selector || !name) {
    throw new Error("selector and name are required");
  }

  const result = await evalInContent(`
    (() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return 'Element not found';
      el.setAttribute(${JSON.stringify(name)}, ${JSON.stringify(value ?? "")});
      return 'Set ' + ${JSON.stringify(name)} + '=' + JSON.stringify(el.getAttribute(${JSON.stringify(name)}));
    })()
  `);
  return [{ type: "text", text: result }];
}

async function removeAttribute(args) {
  const { selector, name } = args;
  if (!selector || !name) {
    throw new Error("selector and name are required");
  }

  const result = await evalInContent(`
    (() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return 'Element not found';
      el.removeAttribute(${JSON.stringify(name)});
      return 'Removed attribute ' + ${JSON.stringify(name)};
    })()
  `);
  return [{ type: "text", text: result }];
}

async function setStyle(args) {
  const { selector, property, value } = args;
  if (!selector || !property) {
    throw new Error("selector and property are required");
  }

  const result = await evalInContent(`
    (() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return 'Element not found';
      el.style.setProperty(${JSON.stringify(property)}, ${JSON.stringify(value ?? "")});
      return 'Set style ' + ${JSON.stringify(property)} + ': ' + el.style.getPropertyValue(${JSON.stringify(property)});
    })()
  `);
  return [{ type: "text", text: result }];
}

async function setStyles(args) {
  const { selector, styles } = args;
  if (!selector || !styles) {
    throw new Error("selector and styles are required");
  }

  const stylesJson = JSON.stringify(styles);
  const result = await evalInContent(`
    (() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return 'Element not found';
      const styles = ${stylesJson};
      for (const [prop, val] of Object.entries(styles)) {
        el.style.setProperty(prop, val);
      }
      return 'Set ' + Object.keys(styles).length + ' style properties';
    })()
  `);
  return [{ type: "text", text: result }];
}

async function getOuterHTML(args) {
  const { selector } = args;
  if (!selector) {
    throw new Error("selector is required");
  }

  const result = await evalInContent(`
    (() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return 'Element not found';
      return el.outerHTML;
    })()
  `);
  return [{ type: "text", text: result }];
}

async function setOuterHTML(args) {
  const { selector, html } = args;
  if (!selector || html === undefined) {
    throw new Error("selector and html are required");
  }

  const result = await evalInContent(`
    (() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return 'Element not found';
      el.outerHTML = ${JSON.stringify(html)};
      return 'outerHTML replaced';
    })()
  `);
  return [{ type: "text", text: result }];
}

async function setInnerHTML(args) {
  const { selector, html } = args;
  if (!selector || html === undefined) {
    throw new Error("selector and html are required");
  }

  const result = await evalInContent(`
    (() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return 'Element not found';
      el.innerHTML = ${JSON.stringify(html)};
      return 'innerHTML set (' + el.innerHTML.length + ' chars)';
    })()
  `);
  return [{ type: "text", text: result }];
}

async function setTextContent(args) {
  const { selector, text } = args;
  if (!selector || text === undefined) {
    throw new Error("selector and text are required");
  }

  const result = await evalInContent(`
    (() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return 'Element not found';
      el.textContent = ${JSON.stringify(text)};
      return 'textContent set';
    })()
  `);
  return [{ type: "text", text: result }];
}

async function removeElement(args) {
  const { selector } = args;
  if (!selector) {
    throw new Error("selector is required");
  }

  const result = await evalInContent(`
    (() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return 'Element not found';
      const tag = el.tagName?.toLowerCase();
      el.remove();
      return 'Removed ' + tag + ' element';
    })()
  `);
  return [{ type: "text", text: result }];
}

async function insertElement(args) {
  const { selector, position = "beforeend", html } = args;
  if (!selector || !html) {
    throw new Error("selector and html are required");
  }

  const result = await evalInContent(`
    (() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return 'Element not found';
      el.insertAdjacentHTML(${JSON.stringify(position)}, ${JSON.stringify(html)});
      return 'Inserted HTML ' + ${JSON.stringify(position)} + ' of ' + el.tagName?.toLowerCase();
    })()
  `);
  return [{ type: "text", text: result }];
}

async function addClass(args) {
  const { selector, className } = args;
  if (!selector || !className) {
    throw new Error("selector and className are required");
  }

  const result = await evalInContent(`
    (() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return 'Element not found';
      el.classList.add(...${JSON.stringify(className)}.split(' '));
      return 'Classes: ' + el.className;
    })()
  `);
  return [{ type: "text", text: result }];
}

async function removeClass(args) {
  const { selector, className } = args;
  if (!selector || !className) {
    throw new Error("selector and className are required");
  }

  const result = await evalInContent(`
    (() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return 'Element not found';
      el.classList.remove(...${JSON.stringify(className)}.split(' '));
      return 'Classes: ' + el.className;
    })()
  `);
  return [{ type: "text", text: result }];
}

async function getDomTree(args) {
  const { selector, depth = 3, maxChildren = 30 } = args;

  const result = await evalInContent(`
    (() => {
      const root = ${selector ? `document.querySelector(${JSON.stringify(selector)})` : "document.documentElement"};
      if (!root) return JSON.stringify({ error: 'Element not found' });

      function walk(el, d) {
        if (d > ${depth}) return { tag: '...', depth: d };
        const node = {
          tag: el.tagName?.toLowerCase(),
        };
        if (el.id) node.id = el.id;
        if (el.className && typeof el.className === 'string' && el.className.trim()) {
          node.class = el.className.trim().substring(0, 150);
        }
        const role = el.getAttribute?.('role');
        if (role) node.role = role;
        const src = el.src || el.href;
        if (src && ['img','a','link','script','iframe','video','audio','source'].includes(node.tag)) {
          node.src = src.substring(0, 200);
        }
        const text = el.childNodes.length === 1 && el.childNodes[0].nodeType === 3
          ? el.textContent?.trim()
          : null;
        if (text && text.length > 0 && text.length < 100) {
          node.text = text;
        }

        if (el.children.length > 0) {
          node.children = [];
          for (let i = 0; i < Math.min(el.children.length, ${maxChildren}); i++) {
            node.children.push(walk(el.children[i], d + 1));
          }
          if (el.children.length > ${maxChildren}) {
            node.children.push({ tag: '...', remaining: el.children.length - ${maxChildren} });
          }
        }
        return node;
      }

      return JSON.stringify(walk(root, 0));
    })()
  `);
  return [{ type: "text", text: result }];
}

async function highlight(args) {
  const { selector, color = "rgba(255, 0, 0, 0.3)", duration = 2000 } = args;
  if (!selector) {
    throw new Error("selector is required");
  }

  const result = await evalInContent(`
    (() => {
      const els = document.querySelectorAll(${JSON.stringify(selector)});
      if (!els.length) return 'No elements found';
      const originals = [];
      els.forEach(el => {
        originals.push({ el, outline: el.style.outline, bg: el.style.backgroundColor });
        el.style.outline = '2px solid red';
        el.style.backgroundColor = ${JSON.stringify(color)};
      });
      setTimeout(() => {
        originals.forEach(({ el, outline, bg }) => {
          el.style.outline = outline;
          el.style.backgroundColor = bg;
        });
      }, ${duration});
      return 'Highlighted ' + els.length + ' element(s) for ${duration}ms';
    })()
  `);
  return [{ type: "text", text: result }];
}

async function scrollTo(args) {
  const { selector, behavior = "smooth" } = args;
  if (!selector) {
    throw new Error("selector is required");
  }

  const result = await evalInContent(`
    (() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return 'Element not found';
      el.scrollIntoView({ behavior: ${JSON.stringify(behavior)}, block: 'center' });
      return 'Scrolled to ' + el.tagName?.toLowerCase() + (el.id ? '#' + el.id : '');
    })()
  `);
  return [{ type: "text", text: result }];
}

async function injectCSS(args) {
  const { css } = args;
  if (!css) {
    throw new Error("css is required");
  }

  const result = await evalInContent(`
    (() => {
      const style = document.createElement('style');
      style.setAttribute('data-mcp-injected', 'true');
      style.textContent = ${JSON.stringify(css)};
      document.head.appendChild(style);
      return 'Injected ' + ${JSON.stringify(css)}.length + ' chars of CSS';
    })()
  `);
  return [{ type: "text", text: result }];
}

async function injectScript(args) {
  const { code } = args;
  if (!code) {
    throw new Error("code is required");
  }

  const result = await evalInContent(code);
  return [{ type: "text", text: result }];
}

export const ElementTools = {
  tools: [
    {
      name: "element_set_attribute",
      description: "Set an attribute on an element",
      inputSchema: {
        type: "object",
        properties: {
          selector: { type: "string", description: "CSS selector" },
          name: { type: "string", description: "Attribute name" },
          value: { type: "string", description: "Attribute value" },
        },
        required: ["selector", "name"],
      },
      handler: setAttribute,
    },
    {
      name: "element_remove_attribute",
      description: "Remove an attribute from an element",
      inputSchema: {
        type: "object",
        properties: {
          selector: { type: "string", description: "CSS selector" },
          name: { type: "string", description: "Attribute name to remove" },
        },
        required: ["selector", "name"],
      },
      handler: removeAttribute,
    },
    {
      name: "element_set_style",
      description: "Set a single CSS style property on an element",
      inputSchema: {
        type: "object",
        properties: {
          selector: { type: "string", description: "CSS selector" },
          property: {
            type: "string",
            description: "CSS property (e.g. 'color', 'display')",
          },
          value: { type: "string", description: "CSS value" },
        },
        required: ["selector", "property"],
      },
      handler: setStyle,
    },
    {
      name: "element_set_styles",
      description: "Set multiple CSS style properties on an element at once",
      inputSchema: {
        type: "object",
        properties: {
          selector: { type: "string", description: "CSS selector" },
          styles: {
            type: "object",
            description:
              "CSS properties as key-value pairs (e.g. {color: 'red', display: 'none'})",
          },
        },
        required: ["selector", "styles"],
      },
      handler: setStyles,
    },
    {
      name: "element_get_html",
      description: "Get the outerHTML of an element",
      inputSchema: {
        type: "object",
        properties: {
          selector: { type: "string", description: "CSS selector" },
        },
        required: ["selector"],
      },
      handler: getOuterHTML,
    },
    {
      name: "element_set_outer_html",
      description: "Replace an element entirely with new HTML",
      inputSchema: {
        type: "object",
        properties: {
          selector: { type: "string", description: "CSS selector" },
          html: {
            type: "string",
            description: "New HTML to replace the element",
          },
        },
        required: ["selector", "html"],
      },
      handler: setOuterHTML,
    },
    {
      name: "element_set_inner_html",
      description: "Set the innerHTML of an element",
      inputSchema: {
        type: "object",
        properties: {
          selector: { type: "string", description: "CSS selector" },
          html: { type: "string", description: "New inner HTML" },
        },
        required: ["selector", "html"],
      },
      handler: setInnerHTML,
    },
    {
      name: "element_set_text",
      description: "Set the text content of an element",
      inputSchema: {
        type: "object",
        properties: {
          selector: { type: "string", description: "CSS selector" },
          text: { type: "string", description: "New text content" },
        },
        required: ["selector", "text"],
      },
      handler: setTextContent,
    },
    {
      name: "element_remove",
      description: "Remove an element from the DOM",
      inputSchema: {
        type: "object",
        properties: {
          selector: { type: "string", description: "CSS selector" },
        },
        required: ["selector"],
      },
      handler: removeElement,
    },
    {
      name: "element_insert",
      description: "Insert HTML adjacent to an element",
      inputSchema: {
        type: "object",
        properties: {
          selector: {
            type: "string",
            description: "CSS selector of the reference element",
          },
          position: {
            type: "string",
            enum: ["beforebegin", "afterbegin", "beforeend", "afterend"],
            description:
              "Where to insert relative to element (default: beforeend)",
          },
          html: { type: "string", description: "HTML to insert" },
        },
        required: ["selector", "html"],
      },
      handler: insertElement,
    },
    {
      name: "element_add_class",
      description: "Add CSS class(es) to an element",
      inputSchema: {
        type: "object",
        properties: {
          selector: { type: "string", description: "CSS selector" },
          className: {
            type: "string",
            description: "Space-separated class names to add",
          },
        },
        required: ["selector", "className"],
      },
      handler: addClass,
    },
    {
      name: "element_remove_class",
      description: "Remove CSS class(es) from an element",
      inputSchema: {
        type: "object",
        properties: {
          selector: { type: "string", description: "CSS selector" },
          className: {
            type: "string",
            description: "Space-separated class names to remove",
          },
        },
        required: ["selector", "className"],
      },
      handler: removeClass,
    },
    {
      name: "element_dom_tree",
      description:
        "Get a detailed DOM subtree with tags, ids, classes, roles, text, and sources",
      inputSchema: {
        type: "object",
        properties: {
          selector: {
            type: "string",
            description: "CSS selector (default: document root)",
          },
          depth: {
            type: "integer",
            description: "Max depth to traverse (default: 3)",
          },
          maxChildren: {
            type: "integer",
            description: "Max children per node (default: 30)",
          },
        },
      },
      handler: getDomTree,
    },
    {
      name: "element_highlight",
      description:
        "Visually highlight element(s) on the page with a colored overlay",
      inputSchema: {
        type: "object",
        properties: {
          selector: {
            type: "string",
            description: "CSS selector (highlights all matches)",
          },
          color: {
            type: "string",
            description: "Background color (default: rgba(255,0,0,0.3))",
          },
          duration: {
            type: "integer",
            description: "Duration in ms (default: 2000)",
          },
        },
        required: ["selector"],
      },
      handler: highlight,
    },
    {
      name: "element_scroll_to",
      description: "Scroll an element into view",
      inputSchema: {
        type: "object",
        properties: {
          selector: { type: "string", description: "CSS selector" },
          behavior: {
            type: "string",
            enum: ["smooth", "instant", "auto"],
            description: "Scroll behavior (default: smooth)",
          },
        },
        required: ["selector"],
      },
      handler: scrollTo,
    },
    {
      name: "page_inject_css",
      description: "Inject custom CSS into the page",
      inputSchema: {
        type: "object",
        properties: {
          css: { type: "string", description: "CSS code to inject" },
        },
        required: ["css"],
      },
      handler: injectCSS,
    },
    {
      name: "page_inject_script",
      description: "Inject and execute JavaScript code in the page context",
      inputSchema: {
        type: "object",
        properties: {
          code: { type: "string", description: "JavaScript code to execute" },
        },
        required: ["code"],
      },
      handler: injectScript,
    },
  ],
};
