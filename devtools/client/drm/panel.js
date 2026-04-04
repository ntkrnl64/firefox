/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// DISCLAIMER: This file is part of an unofficial Firefox modification that adds
// DRM/EME debugging tools. It is NOT endorsed by or affiliated with Mozilla.
// The DRM media capture functionality bypasses content protection restrictions
// and is intended ONLY for developer debugging and testing purposes.
// Do NOT use in production or to circumvent digital rights management.

"use strict";

class DrmPanel {
  constructor(panelWin, toolbox, commands) {
    this.panelWin = panelWin;
    this.toolbox = toolbox;
    this.commands = commands;
  }

  async open() {
    await this.panelWin.DrmApp.bootstrap({
      toolbox: this.toolbox,
      commands: this.commands,
      panel: this,
    });

    return this;
  }

  destroy() {
    this.panelWin.DrmApp.destroy();
    this.panelWin = null;
    this.toolbox = null;
    this.emit("destroyed");
  }
}

exports.DrmPanel = DrmPanel;
