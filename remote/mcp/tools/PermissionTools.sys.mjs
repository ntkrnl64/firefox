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

function capabilityToString(capability) {
  switch (capability) {
    case Ci.nsIPermissionManager.ALLOW_ACTION:
      return "allow";
    case Ci.nsIPermissionManager.DENY_ACTION:
      return "deny";
    case Ci.nsIPermissionManager.PROMPT_ACTION:
      return "prompt";
    default:
      return "unknown";
  }
}

function stringToCapability(str) {
  switch (str) {
    case "allow":
      return Ci.nsIPermissionManager.ALLOW_ACTION;
    case "deny":
      return Ci.nsIPermissionManager.DENY_ACTION;
    case "prompt":
      return Ci.nsIPermissionManager.PROMPT_ACTION;
    default:
      throw new Error(
        `Invalid permission value: ${str}. Use allow, deny, or prompt.`
      );
  }
}

async function getPermissions(args) {
  const { origin } = args;

  let principal;
  if (origin) {
    principal =
      Services.scriptSecurityManager.createContentPrincipalFromOrigin(origin);
  } else {
    const browser = getActiveBrowser();
    principal = browser.contentPrincipal;
  }

  if (!principal || principal.isNullPrincipal) {
    return [{ type: "text", text: JSON.stringify([]) }];
  }

  const perms = [];
  for (const perm of Services.perms.getAllForPrincipal(principal)) {
    perms.push({
      type: perm.type,
      capability: capabilityToString(perm.capability),
      expireType: perm.expireType,
      expireTime: perm.expireTime || undefined,
    });
  }

  return [{ type: "text", text: JSON.stringify(perms, null, 2) }];
}

async function setPermission(args) {
  const { type, value, origin } = args;
  if (!type) {
    throw new Error("type is required");
  }
  if (!value) {
    throw new Error("value is required (allow, deny, or prompt)");
  }

  let principal;
  if (origin) {
    principal =
      Services.scriptSecurityManager.createContentPrincipalFromOrigin(origin);
  } else {
    const browser = getActiveBrowser();
    principal = browser.contentPrincipal;
  }

  if (!principal || principal.isNullPrincipal) {
    throw new Error("Cannot set permissions for this page");
  }

  const capability = stringToCapability(value);
  Services.perms.addFromPrincipal(
    principal,
    type,
    capability,
    Ci.nsIPermissionManager.EXPIRE_NEVER,
    0
  );

  return [
    {
      type: "text",
      text: `Permission "${type}" set to "${value}" for ${principal.origin}`,
    },
  ];
}

async function removePermission(args) {
  const { type, origin } = args;
  if (!type) {
    throw new Error("type is required");
  }

  let principal;
  if (origin) {
    principal =
      Services.scriptSecurityManager.createContentPrincipalFromOrigin(origin);
  } else {
    const browser = getActiveBrowser();
    principal = browser.contentPrincipal;
  }

  if (!principal || principal.isNullPrincipal) {
    throw new Error("Cannot remove permissions for this page");
  }

  Services.perms.removeFromPrincipal(principal, type);
  return [
    {
      type: "text",
      text: `Permission "${type}" removed for ${principal.origin}`,
    },
  ];
}

async function listAllPermissions(args) {
  const { type } = args;
  const perms = [];
  for (const perm of Services.perms.all) {
    if (type && perm.type !== type) {
      continue;
    }
    perms.push({
      origin: perm.principal?.origin || "unknown",
      type: perm.type,
      capability: capabilityToString(perm.capability),
    });
  }
  return [{ type: "text", text: JSON.stringify(perms, null, 2) }];
}

export const PermissionTools = {
  tools: [
    {
      name: "permissions_get",
      description: "Get permissions for the current site or a specific origin",
      inputSchema: {
        type: "object",
        properties: {
          origin: {
            type: "string",
            description: "Site origin (default: current page)",
          },
        },
      },
      handler: getPermissions,
    },
    {
      name: "permissions_set",
      description:
        "Set a permission (camera, microphone, geo, notifications, etc.) for a site",
      inputSchema: {
        type: "object",
        properties: {
          type: {
            type: "string",
            description:
              "Permission type (e.g. camera, microphone, geo, desktop-notification)",
          },
          value: {
            type: "string",
            enum: ["allow", "deny", "prompt"],
            description: "Permission value",
          },
          origin: {
            type: "string",
            description: "Site origin (default: current page)",
          },
        },
        required: ["type", "value"],
      },
      handler: setPermission,
    },
    {
      name: "permissions_remove",
      description: "Remove a specific permission for a site",
      inputSchema: {
        type: "object",
        properties: {
          type: { type: "string", description: "Permission type to remove" },
          origin: {
            type: "string",
            description: "Site origin (default: current page)",
          },
        },
        required: ["type"],
      },
      handler: removePermission,
    },
    {
      name: "permissions_list_all",
      description: "List all site permissions, optionally filtered by type",
      inputSchema: {
        type: "object",
        properties: {
          type: { type: "string", description: "Filter by permission type" },
        },
      },
      handler: listAllPermissions,
    },
  ],
};
