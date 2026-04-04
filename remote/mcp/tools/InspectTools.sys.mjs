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

async function listScripts() {
  const result = await evalInContent(`
    (() => {
      const scripts = Array.from(document.querySelectorAll('script'));
      return JSON.stringify(scripts.map((s, i) => ({
        index: i,
        src: s.src || undefined,
        type: s.type || undefined,
        async: s.async,
        defer: s.defer,
        inlineLength: s.src ? undefined : s.textContent.length,
        inlinePreview: s.src ? undefined : s.textContent.substring(0, 200),
      })));
    })()
  `);
  return [{ type: "text", text: result }];
}

async function listStylesheets() {
  const result = await evalInContent(`
    (() => {
      const sheets = [];
      for (let i = 0; i < document.styleSheets.length; i++) {
        const s = document.styleSheets[i];
        sheets.push({
          index: i,
          href: s.href || '(inline)',
          media: s.media?.mediaText || undefined,
          disabled: s.disabled,
          rulesCount: (() => { try { return s.cssRules?.length; } catch { return 'cross-origin'; } })(),
        });
      }
      return JSON.stringify(sheets);
    })()
  `);
  return [{ type: "text", text: result }];
}

async function listIframes() {
  const result = await evalInContent(`
    (() => {
      const frames = Array.from(document.querySelectorAll('iframe, frame'));
      return JSON.stringify(frames.map((f, i) => ({
        index: i,
        src: f.src || undefined,
        name: f.name || undefined,
        id: f.id || undefined,
        sandbox: f.sandbox?.value || undefined,
        width: f.width || undefined,
        height: f.height || undefined,
        hidden: f.hidden || !f.checkVisibility?.(),
      })));
    })()
  `);
  return [{ type: "text", text: result }];
}

async function listForms() {
  const result = await evalInContent(`
    (() => {
      const forms = Array.from(document.querySelectorAll('form'));
      return JSON.stringify(forms.map((f, i) => ({
        index: i,
        action: f.action || undefined,
        method: f.method || 'get',
        id: f.id || undefined,
        name: f.name || undefined,
        encoding: f.encoding,
        inputs: Array.from(f.elements).map(el => ({
          tag: el.tagName?.toLowerCase(),
          type: el.type || undefined,
          name: el.name || undefined,
          id: el.id || undefined,
          value: el.type === 'password' ? '***' : (el.value || '').substring(0, 100),
          hidden: el.type === 'hidden',
          placeholder: el.placeholder || undefined,
        })),
      })));
    })()
  `);
  return [{ type: "text", text: result }];
}

async function listHiddenElements() {
  const result = await evalInContent(`
    (() => {
      const hidden = [];
      const all = document.querySelectorAll('input[type=hidden], [style*="display:none"], [style*="display: none"], [hidden], [aria-hidden="true"]');
      all.forEach((el, i) => {
        if (hidden.length >= 200) return;
        hidden.push({
          index: i,
          tag: el.tagName?.toLowerCase(),
          type: el.type || undefined,
          name: el.name || undefined,
          id: el.id || undefined,
          value: (el.value || '').substring(0, 200),
          reason: el.type === 'hidden' ? 'type=hidden'
            : el.hidden ? 'hidden attr'
            : el.getAttribute('aria-hidden') === 'true' ? 'aria-hidden'
            : 'display:none',
          dataAttributes: Object.fromEntries(
            Array.from(el.attributes || [])
              .filter(a => a.name.startsWith('data-'))
              .map(a => [a.name, a.value.substring(0, 100)])
          ),
        });
      });
      return JSON.stringify(hidden);
    })()
  `);
  return [{ type: "text", text: result }];
}

async function listDataAttributes(args) {
  const { selector = "*" } = args;
  const result = await evalInContent(`
    (() => {
      const results = [];
      const els = document.querySelectorAll(${JSON.stringify(selector)});
      els.forEach(el => {
        const dataAttrs = {};
        let hasData = false;
        for (const attr of el.attributes) {
          if (attr.name.startsWith('data-')) {
            dataAttrs[attr.name] = attr.value.substring(0, 200);
            hasData = true;
          }
        }
        if (hasData && results.length < 200) {
          results.push({
            tag: el.tagName?.toLowerCase(),
            id: el.id || undefined,
            className: (el.className || '').substring(0, 100),
            data: dataAttrs,
          });
        }
      });
      return JSON.stringify(results);
    })()
  `);
  return [{ type: "text", text: result }];
}

async function listGlobalVariables() {
  const result = await evalInContent(`
    (() => {
      const iframe = document.createElement('iframe');
      iframe.style.display = 'none';
      document.body.appendChild(iframe);
      const defaultKeys = new Set(Object.keys(iframe.contentWindow));
      document.body.removeChild(iframe);

      const custom = {};
      for (const key of Object.keys(window)) {
        if (!defaultKeys.has(key)) {
          const val = window[key];
          const type = typeof val;
          let preview;
          if (type === 'function') {
            preview = 'function()';
          } else if (type === 'object' && val !== null) {
            try {
              preview = JSON.stringify(val).substring(0, 200);
            } catch {
              preview = Object.prototype.toString.call(val);
            }
          } else {
            preview = String(val).substring(0, 200);
          }
          custom[key] = { type, preview };
        }
      }
      return JSON.stringify(custom);
    })()
  `);
  return [{ type: "text", text: result }];
}

async function listLinks() {
  const result = await evalInContent(`
    (() => {
      const links = [];
      document.querySelectorAll('a[href]').forEach(a => {
        if (links.length >= 300) return;
        links.push({
          href: a.href,
          text: (a.textContent || '').trim().substring(0, 100),
          rel: a.rel || undefined,
          target: a.target || undefined,
          isExternal: a.hostname !== location.hostname,
        });
      });
      return JSON.stringify(links);
    })()
  `);
  return [{ type: "text", text: result }];
}

async function listMetaTags() {
  const result = await evalInContent(`
    (() => {
      const metas = Array.from(document.querySelectorAll('meta, link[rel]'));
      return JSON.stringify(metas.map(m => {
        if (m.tagName === 'META') {
          return {
            tag: 'meta',
            name: m.name || m.getAttribute('property') || m.httpEquiv || undefined,
            content: (m.content || '').substring(0, 300),
            charset: m.charset || undefined,
          };
        }
        return {
          tag: 'link',
          rel: m.rel,
          href: m.href,
          type: m.type || undefined,
        };
      }));
    })()
  `);
  return [{ type: "text", text: result }];
}

async function getServiceWorkers() {
  const result = await evalInContent(`
    (async () => {
      if (!navigator.serviceWorker) return JSON.stringify([]);
      const registrations = await navigator.serviceWorker.getRegistrations();
      return JSON.stringify(registrations.map(r => ({
        scope: r.scope,
        active: r.active ? { scriptURL: r.active.scriptURL, state: r.active.state } : null,
        waiting: r.waiting ? { scriptURL: r.waiting.scriptURL } : null,
        installing: r.installing ? { scriptURL: r.installing.scriptURL } : null,
      })));
    })()
  `);
  return [{ type: "text", text: result }];
}

async function getPageStructure() {
  const result = await evalInContent(`
    (() => {
      function summarize(el, depth) {
        if (depth > 4) return null;
        const children = [];
        for (const child of el.children) {
          if (children.length >= 20) {
            children.push({ tag: '...', count: el.children.length - 20 });
            break;
          }
          const summary = summarize(child, depth + 1);
          if (summary) children.push(summary);
        }
        const node = { tag: el.tagName?.toLowerCase() };
        if (el.id) node.id = el.id;
        if (el.className && typeof el.className === 'string') {
          node.class = el.className.split(' ').slice(0, 5).join(' ');
        }
        const role = el.getAttribute('role');
        if (role) node.role = role;
        if (children.length) node.children = children;
        return node;
      }
      return JSON.stringify(summarize(document.body, 0));
    })()
  `);
  return [{ type: "text", text: result }];
}

export const InspectTools = {
  tools: [
    {
      name: "inspect_scripts",
      description:
        "List all script elements on the page with src, type, and inline preview",
      inputSchema: { type: "object", properties: {} },
      handler: listScripts,
    },
    {
      name: "inspect_stylesheets",
      description: "List all stylesheets loaded on the page",
      inputSchema: { type: "object", properties: {} },
      handler: listStylesheets,
    },
    {
      name: "inspect_iframes",
      description: "List all iframes/frames on the page",
      inputSchema: { type: "object", properties: {} },
      handler: listIframes,
    },
    {
      name: "inspect_forms",
      description: "List all forms with their inputs, actions, and methods",
      inputSchema: { type: "object", properties: {} },
      handler: listForms,
    },
    {
      name: "inspect_hidden_elements",
      description:
        "Find hidden inputs, display:none elements, and aria-hidden elements",
      inputSchema: { type: "object", properties: {} },
      handler: listHiddenElements,
    },
    {
      name: "inspect_data_attributes",
      description:
        "List all data-* attributes on elements, useful for finding framework state",
      inputSchema: {
        type: "object",
        properties: {
          selector: {
            type: "string",
            description: "CSS selector to scope search (default: all elements)",
          },
        },
      },
      handler: listDataAttributes,
    },
    {
      name: "inspect_globals",
      description:
        "List all non-default global JavaScript variables set by the page",
      inputSchema: { type: "object", properties: {} },
      handler: listGlobalVariables,
    },
    {
      name: "inspect_links",
      description:
        "List all links on the page with href, text, and external flag",
      inputSchema: { type: "object", properties: {} },
      handler: listLinks,
    },
    {
      name: "inspect_meta",
      description:
        "List all meta tags and link elements (SEO, OpenGraph, etc.)",
      inputSchema: { type: "object", properties: {} },
      handler: listMetaTags,
    },
    {
      name: "inspect_service_workers",
      description: "List registered service workers and their status",
      inputSchema: { type: "object", properties: {} },
      handler: getServiceWorkers,
    },
    {
      name: "inspect_page_structure",
      description:
        "Get a summarized DOM tree (tag/id/class/role) to understand page layout",
      inputSchema: { type: "object", properties: {} },
      handler: getPageStructure,
    },
  ],
};
