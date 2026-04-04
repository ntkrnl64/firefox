/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

function getActiveBrowser() {
  const win = Services.wm.getMostRecentBrowserWindow();
  if (!win?.gBrowser) {
    throw new Error("No browser window available");
  }
  return win.gBrowser.selectedBrowser;
}

function cookieToJSON(cookie) {
  return {
    name: cookie.name,
    value: cookie.value,
    domain: cookie.host,
    path: cookie.path,
    secure: cookie.isSecure,
    httpOnly: cookie.isHttpOnly,
    sameSite: ["none", "lax", "strict"][cookie.sameSite] || "none",
    expirationDate: cookie.isSession ? null : cookie.expiry,
    isSession: cookie.isSession,
  };
}

async function getCookies(args) {
  const { domain, name } = args;
  const browser = getActiveBrowser();

  let host;
  if (domain) {
    host = domain;
  } else {
    try {
      host = browser.currentURI.host;
    } catch {
      return [{ type: "text", text: "[]" }];
    }
  }

  const cookies = [];
  for (const cookie of Services.cookies.getCookiesFromHost(host, {})) {
    if (name && cookie.name !== name) {
      continue;
    }
    cookies.push(cookieToJSON(cookie));
  }

  return [{ type: "text", text: JSON.stringify(cookies, null, 2) }];
}

async function setCookie(args) {
  const {
    name,
    value,
    domain,
    path = "/",
    secure = false,
    httpOnly = false,
    sameSite = "none",
    expirationDate,
  } = args;

  if (!name) {
    throw new Error("name is required");
  }
  if (value === undefined) {
    throw new Error("value is required");
  }

  const browser = getActiveBrowser();
  let host = domain;
  if (!host) {
    try {
      host = browser.currentURI.host;
    } catch {
      throw new Error("Cannot determine domain; provide domain parameter");
    }
  }

  const sameSiteMap = { none: 0, lax: 1, strict: 2 };
  const sameSiteValue = sameSiteMap[sameSite] ?? 0;

  const expiry = expirationDate
    ? Math.floor(expirationDate)
    : Math.floor(Date.now() / 1000) + 86400 * 365;

  Services.cookies.add(
    host,
    path,
    name,
    value,
    secure,
    httpOnly,
    false, // isSession
    expiry,
    {}, // originAttributes
    sameSiteValue,
    Ci.nsICookie.SCHEME_UNSET
  );

  return [{ type: "text", text: `Cookie "${name}" set for ${host}` }];
}

async function deleteCookie(args) {
  const { name, domain } = args;

  if (!name) {
    throw new Error("name is required");
  }

  const browser = getActiveBrowser();
  let host = domain;
  if (!host) {
    try {
      host = browser.currentURI.host;
    } catch {
      throw new Error("Cannot determine domain; provide domain parameter");
    }
  }

  Services.cookies.remove(host, name, "/", {});
  return [{ type: "text", text: `Cookie "${name}" deleted from ${host}` }];
}

async function deleteAllCookies(args) {
  const { domain } = args;

  if (domain) {
    Services.cookies.removeCookiesFromExactHost(domain, "{}");
    return [{ type: "text", text: `All cookies deleted for ${domain}` }];
  }

  const browser = getActiveBrowser();
  let host;
  try {
    host = browser.currentURI.host;
  } catch {
    throw new Error("Cannot determine domain; provide domain parameter");
  }

  Services.cookies.removeCookiesFromExactHost(host, "{}");
  return [{ type: "text", text: `All cookies deleted for ${host}` }];
}

export const CookieTools = {
  tools: [
    {
      name: "cookies_get",
      description: "Get cookies for the current page or a specific domain",
      inputSchema: {
        type: "object",
        properties: {
          domain: {
            type: "string",
            description:
              "Domain to get cookies for (default: current page domain)",
          },
          name: {
            type: "string",
            description: "Filter by cookie name",
          },
        },
      },
      handler: getCookies,
    },
    {
      name: "cookies_set",
      description: "Set a cookie",
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string", description: "Cookie name" },
          value: { type: "string", description: "Cookie value" },
          domain: {
            type: "string",
            description: "Domain (default: current page domain)",
          },
          path: { type: "string", description: "Cookie path (default: /)" },
          secure: { type: "boolean", description: "Secure flag" },
          httpOnly: { type: "boolean", description: "HttpOnly flag" },
          sameSite: {
            type: "string",
            enum: ["none", "lax", "strict"],
            description: "SameSite attribute",
          },
          expirationDate: {
            type: "number",
            description: "Expiration as Unix timestamp in seconds",
          },
        },
        required: ["name", "value"],
      },
      handler: setCookie,
    },
    {
      name: "cookies_delete",
      description: "Delete a specific cookie by name",
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string", description: "Cookie name to delete" },
          domain: {
            type: "string",
            description: "Domain (default: current page domain)",
          },
        },
        required: ["name"],
      },
      handler: deleteCookie,
    },
    {
      name: "cookies_delete_all",
      description: "Delete all cookies for a domain",
      inputSchema: {
        type: "object",
        properties: {
          domain: {
            type: "string",
            description: "Domain (default: current page domain)",
          },
        },
      },
      handler: deleteAllCookies,
    },
  ],
};
