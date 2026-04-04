/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const lazy = {};

ChromeUtils.defineESModuleGetters(lazy, {
  AddonManager: "resource://gre/modules/AddonManager.sys.mjs",
});

function addonToJSON(addon) {
  return {
    id: addon.id,
    name: addon.name,
    version: addon.version,
    type: addon.type,
    description: addon.description?.substring(0, 200) || "",
    isActive: addon.isActive,
    isBuiltin: addon.isBuiltin,
    creator: addon.creator?.name || addon.creator || undefined,
    homepageURL: addon.homepageURL || undefined,
  };
}

async function listExtensions(args) {
  const { type } = args;
  let addons;
  if (type) {
    addons = await lazy.AddonManager.getAddonsByTypes([type]);
  } else {
    addons = await lazy.AddonManager.getAllAddons();
  }
  return [
    { type: "text", text: JSON.stringify(addons.map(addonToJSON), null, 2) },
  ];
}

async function getExtension(args) {
  const { id } = args;
  if (!id) {
    throw new Error("id is required");
  }
  const addon = await lazy.AddonManager.getAddonByID(id);
  if (!addon) {
    return [{ type: "text", text: `Extension not found: ${id}` }];
  }
  return [{ type: "text", text: JSON.stringify(addonToJSON(addon), null, 2) }];
}

async function enableExtension(args) {
  const { id } = args;
  if (!id) {
    throw new Error("id is required");
  }
  const addon = await lazy.AddonManager.getAddonByID(id);
  if (!addon) {
    throw new Error(`Extension not found: ${id}`);
  }
  await addon.enable();
  return [{ type: "text", text: `Extension "${addon.name}" enabled` }];
}

async function disableExtension(args) {
  const { id } = args;
  if (!id) {
    throw new Error("id is required");
  }
  const addon = await lazy.AddonManager.getAddonByID(id);
  if (!addon) {
    throw new Error(`Extension not found: ${id}`);
  }
  await addon.disable();
  return [{ type: "text", text: `Extension "${addon.name}" disabled` }];
}

async function uninstallExtension(args) {
  const { id } = args;
  if (!id) {
    throw new Error("id is required");
  }
  const addon = await lazy.AddonManager.getAddonByID(id);
  if (!addon) {
    throw new Error(`Extension not found: ${id}`);
  }
  await addon.uninstall();
  return [{ type: "text", text: `Extension "${addon.name}" uninstalled` }];
}

export const ExtensionTools = {
  tools: [
    {
      name: "extensions_list",
      description: "List all installed extensions/addons",
      inputSchema: {
        type: "object",
        properties: {
          type: {
            type: "string",
            enum: [
              "extension",
              "theme",
              "dictionary",
              "locale",
              "sitepermission",
            ],
            description: "Filter by addon type (default: all)",
          },
        },
      },
      handler: listExtensions,
    },
    {
      name: "extensions_get",
      description: "Get details of a specific extension by ID",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string", description: "Extension ID" },
        },
        required: ["id"],
      },
      handler: getExtension,
    },
    {
      name: "extensions_enable",
      description: "Enable a disabled extension",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string", description: "Extension ID to enable" },
        },
        required: ["id"],
      },
      handler: enableExtension,
    },
    {
      name: "extensions_disable",
      description: "Disable an extension",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string", description: "Extension ID to disable" },
        },
        required: ["id"],
      },
      handler: disableExtension,
    },
    {
      name: "extensions_uninstall",
      description: "Uninstall an extension",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string", description: "Extension ID to uninstall" },
        },
        required: ["id"],
      },
      handler: uninstallExtension,
    },
  ],
};
