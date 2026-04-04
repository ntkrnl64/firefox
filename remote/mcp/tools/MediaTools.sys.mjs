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

async function listMedia() {
  const script = `
    (() => {
      const media = [];
      document.querySelectorAll('video, audio').forEach((el, i) => {
        media.push({
          index: i,
          tagName: el.tagName.toLowerCase(),
          src: el.currentSrc || el.src || undefined,
          paused: el.paused,
          muted: el.muted,
          volume: el.volume,
          currentTime: el.currentTime,
          duration: isFinite(el.duration) ? el.duration : undefined,
          loop: el.loop,
          playbackRate: el.playbackRate,
          readyState: el.readyState,
        });
      });
      return JSON.stringify(media);
    })()
  `;
  const result = await evalInContent(script);
  return [{ type: "text", text: result }];
}

async function playMedia(args) {
  const { index = 0 } = args;
  const script = `
    (() => {
      const els = document.querySelectorAll('video, audio');
      if (${index} >= els.length) return 'No media element at index ${index}';
      els[${index}].play();
      return 'Playing ' + els[${index}].tagName.toLowerCase();
    })()
  `;
  const result = await evalInContent(script);
  return [{ type: "text", text: result }];
}

async function pauseMedia(args) {
  const { index = 0 } = args;
  const script = `
    (() => {
      const els = document.querySelectorAll('video, audio');
      if (${index} >= els.length) return 'No media element at index ${index}';
      els[${index}].pause();
      return 'Paused ' + els[${index}].tagName.toLowerCase();
    })()
  `;
  const result = await evalInContent(script);
  return [{ type: "text", text: result }];
}

async function muteMedia(args) {
  const { index = 0, muted = true } = args;
  const script = `
    (() => {
      const els = document.querySelectorAll('video, audio');
      if (${index} >= els.length) return 'No media element at index ${index}';
      els[${index}].muted = ${muted};
      return (${muted} ? 'Muted' : 'Unmuted') + ' ' + els[${index}].tagName.toLowerCase();
    })()
  `;
  const result = await evalInContent(script);
  return [{ type: "text", text: result }];
}

async function setVolume(args) {
  const { index = 0, volume } = args;
  if (volume === undefined) {
    throw new Error("volume is required (0.0 to 1.0)");
  }
  const script = `
    (() => {
      const els = document.querySelectorAll('video, audio');
      if (${index} >= els.length) return 'No media element at index ${index}';
      els[${index}].volume = ${Math.max(0, Math.min(1, volume))};
      return 'Volume set to ' + els[${index}].volume;
    })()
  `;
  const result = await evalInContent(script);
  return [{ type: "text", text: result }];
}

async function seekMedia(args) {
  const { index = 0, time } = args;
  if (time === undefined) {
    throw new Error("time is required (in seconds)");
  }
  const script = `
    (() => {
      const els = document.querySelectorAll('video, audio');
      if (${index} >= els.length) return 'No media element at index ${index}';
      els[${index}].currentTime = ${time};
      return 'Seeked to ' + els[${index}].currentTime + 's';
    })()
  `;
  const result = await evalInContent(script);
  return [{ type: "text", text: result }];
}

async function setPlaybackRate(args) {
  const { index = 0, rate = 1.0 } = args;
  const script = `
    (() => {
      const els = document.querySelectorAll('video, audio');
      if (${index} >= els.length) return 'No media element at index ${index}';
      els[${index}].playbackRate = ${rate};
      return 'Playback rate set to ' + els[${index}].playbackRate + 'x';
    })()
  `;
  const result = await evalInContent(script);
  return [{ type: "text", text: result }];
}

async function toggleLoop(args) {
  const { index = 0 } = args;
  const script = `
    (() => {
      const els = document.querySelectorAll('video, audio');
      if (${index} >= els.length) return 'No media element at index ${index}';
      els[${index}].loop = !els[${index}].loop;
      return 'Loop ' + (els[${index}].loop ? 'enabled' : 'disabled');
    })()
  `;
  const result = await evalInContent(script);
  return [{ type: "text", text: result }];
}

async function fullscreenMedia(args) {
  const { index = 0 } = args;
  const script = `
    (() => {
      const els = document.querySelectorAll('video, audio');
      if (${index} >= els.length) return 'No media element at index ${index}';
      if (els[${index}].tagName.toLowerCase() !== 'video') return 'Fullscreen only for video elements';
      if (document.fullscreenElement) {
        document.exitFullscreen();
        return 'Exited fullscreen';
      }
      els[${index}].requestFullscreen();
      return 'Entered fullscreen';
    })()
  `;
  const result = await evalInContent(script);
  return [{ type: "text", text: result }];
}

export const MediaTools = {
  tools: [
    {
      name: "media_list",
      description:
        "List all audio/video elements on the page with their status",
      inputSchema: { type: "object", properties: {} },
      handler: listMedia,
    },
    {
      name: "media_play",
      description: "Play a media element",
      inputSchema: {
        type: "object",
        properties: {
          index: {
            type: "integer",
            description: "Media element index (default: 0)",
          },
        },
      },
      handler: playMedia,
    },
    {
      name: "media_pause",
      description: "Pause a media element",
      inputSchema: {
        type: "object",
        properties: {
          index: {
            type: "integer",
            description: "Media element index (default: 0)",
          },
        },
      },
      handler: pauseMedia,
    },
    {
      name: "media_mute",
      description: "Mute or unmute a media element",
      inputSchema: {
        type: "object",
        properties: {
          index: {
            type: "integer",
            description: "Media element index (default: 0)",
          },
          muted: {
            type: "boolean",
            description: "true to mute, false to unmute (default: true)",
          },
        },
      },
      handler: muteMedia,
    },
    {
      name: "media_volume",
      description: "Set volume of a media element",
      inputSchema: {
        type: "object",
        properties: {
          index: {
            type: "integer",
            description: "Media element index (default: 0)",
          },
          volume: { type: "number", description: "Volume level 0.0-1.0" },
        },
        required: ["volume"],
      },
      handler: setVolume,
    },
    {
      name: "media_seek",
      description: "Seek a media element to a specific time",
      inputSchema: {
        type: "object",
        properties: {
          index: {
            type: "integer",
            description: "Media element index (default: 0)",
          },
          time: { type: "number", description: "Time in seconds" },
        },
        required: ["time"],
      },
      handler: seekMedia,
    },
    {
      name: "media_playback_rate",
      description: "Set playback speed of a media element",
      inputSchema: {
        type: "object",
        properties: {
          index: {
            type: "integer",
            description: "Media element index (default: 0)",
          },
          rate: {
            type: "number",
            description: "Playback rate (0.5, 1.0, 1.5, 2.0, etc.)",
          },
        },
        required: ["rate"],
      },
      handler: setPlaybackRate,
    },
    {
      name: "media_loop",
      description: "Toggle loop on a media element",
      inputSchema: {
        type: "object",
        properties: {
          index: {
            type: "integer",
            description: "Media element index (default: 0)",
          },
        },
      },
      handler: toggleLoop,
    },
    {
      name: "media_fullscreen",
      description: "Toggle fullscreen on a video element",
      inputSchema: {
        type: "object",
        properties: {
          index: {
            type: "integer",
            description: "Video element index (default: 0)",
          },
        },
      },
      handler: fullscreenMedia,
    },
  ],
};
