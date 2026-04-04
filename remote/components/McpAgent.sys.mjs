/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { XPCOMUtils } from "resource://gre/modules/XPCOMUtils.sys.mjs";

const lazy = {};

ChromeUtils.defineESModuleGetters(lazy, {
  Log: "chrome://remote/content/shared/Log.sys.mjs",
  McpServer: "chrome://remote/content/mcp/McpServer.sys.mjs",
});

ChromeUtils.defineLazyGetter(lazy, "logger", () => lazy.Log.get());

XPCOMUtils.defineLazyPreferenceGetter(
  lazy,
  "mcpEnabled",
  "mcp.server.enabled",
  false
);

XPCOMUtils.defineLazyPreferenceGetter(lazy, "mcpPort", "mcp.server.port", 5195);

const isRemote =
  Services.appinfo.processType == Services.appinfo.PROCESS_TYPE_CONTENT;

class McpAgentParentProcess {
  #server;

  constructor() {
    this.#server = null;
  }

  get running() {
    return this.#server?.running ?? false;
  }

  async observe(subject, topic) {
    switch (topic) {
      case "profile-after-change":
        Services.obs.addObserver(this, "final-ui-startup");
        Services.obs.addObserver(this, "quit-application");

        Services.prefs.addObserver("mcp.server.enabled", this);
        Services.prefs.addObserver("mcp.server.port", this);
        break;

      case "final-ui-startup":
        Services.obs.removeObserver(this, topic);
        if (lazy.mcpEnabled) {
          await this.#start();
        }
        break;

      case "quit-application":
        Services.obs.removeObserver(this, topic);
        Services.prefs.removeObserver("mcp.server.enabled", this);
        Services.prefs.removeObserver("mcp.server.port", this);
        await this.#stop();
        break;

      case "nsPref:changed":
        await this.#onPrefChanged();
        break;
    }
  }

  async #onPrefChanged() {
    if (lazy.mcpEnabled && !this.running) {
      await this.#start();
    } else if (!lazy.mcpEnabled && this.running) {
      await this.#stop();
    } else if (lazy.mcpEnabled && this.running) {
      // Port may have changed; restart.
      await this.#stop();
      await this.#start();
    }
  }

  async #start() {
    if (this.running) {
      return;
    }

    try {
      this.#server = new lazy.McpServer(lazy.mcpPort);
      await this.#server.start();
      lazy.logger.info(`MCP server listening on port ${lazy.mcpPort}`);
      Cu.printStderr(
        `MCP server listening on port ${lazy.mcpPort}\n` +
          `  WebSocket: ws://localhost:${lazy.mcpPort}/mcp\n` +
          `  HTTP/SSE:  http://localhost:${lazy.mcpPort}/mcp\n`
      );
    } catch (e) {
      lazy.logger.error(`Failed to start MCP server: ${e.message}`, e);
      this.#server = null;
    }
  }

  async #stop() {
    if (!this.running) {
      return;
    }

    try {
      await this.#server.stop();
    } catch (e) {
      lazy.logger.error(`Failed to stop MCP server: ${e.message}`, e);
    } finally {
      this.#server = null;
    }
  }

  QueryInterface = ChromeUtils.generateQI(["nsIMcpAgent", "nsIObserver"]);
}

class McpAgentContentProcess {
  get running() {
    return false;
  }

  QueryInterface = ChromeUtils.generateQI(["nsIMcpAgent"]);
}

export var McpAgent;
if (isRemote) {
  McpAgent = new McpAgentContentProcess();
} else {
  McpAgent = new McpAgentParentProcess();
}

export var McpAgentFactory = function () {
  return McpAgent;
};
