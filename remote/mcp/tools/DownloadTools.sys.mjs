/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const lazy = {};

ChromeUtils.defineESModuleGetters(lazy, {
  Downloads: "resource://gre/modules/Downloads.sys.mjs",
});

function downloadToJSON(dl) {
  return {
    source: dl.source?.url || String(dl.source),
    target: dl.target?.path || String(dl.target),
    contentType: dl.contentType || undefined,
    startTime: dl.startTime?.toISOString() || undefined,
    stopped: dl.stopped,
    succeeded: dl.succeeded,
    canceled: dl.canceled,
    error: dl.error
      ? { message: dl.error.message, result: dl.error.result }
      : undefined,
    progress: dl.hasProgress ? dl.progress : undefined,
    currentBytes: dl.currentBytes,
    totalBytes: dl.totalBytes,
    speed: dl.speed || undefined,
  };
}

async function listDownloads(args) {
  const { count = 50 } = args;
  const list = await lazy.Downloads.getList(lazy.Downloads.ALL);
  const downloads = await list.getAll();
  const recent = downloads.slice(-count).reverse();
  return [
    { type: "text", text: JSON.stringify(recent.map(downloadToJSON), null, 2) },
  ];
}

async function startDownload(args) {
  const { url, filename } = args;
  if (!url) {
    throw new Error("url is required");
  }

  const downloadsDir = await lazy.Downloads.getPreferredDownloadsDirectory();
  let targetPath;
  if (filename) {
    targetPath = PathUtils.join(downloadsDir, filename);
  } else {
    const urlObj = new URL(url);
    const name = urlObj.pathname.split("/").pop() || "download";
    targetPath = PathUtils.join(downloadsDir, name);
  }

  const list = await lazy.Downloads.getList(lazy.Downloads.PUBLIC);
  const download = await lazy.Downloads.createDownload({
    source: url,
    target: targetPath,
  });

  await list.add(download);
  download.start().catch(() => {});

  return [
    {
      type: "text",
      text: JSON.stringify(
        {
          message: "Download started",
          target: targetPath,
          source: url,
        },
        null,
        2
      ),
    },
  ];
}

async function cancelDownload(args) {
  const { index = 0 } = args;
  const list = await lazy.Downloads.getList(lazy.Downloads.ALL);
  const downloads = await list.getAll();

  const active = downloads.filter(d => !d.stopped);
  if (index >= active.length) {
    return [{ type: "text", text: "No active download at that index" }];
  }

  await active[index].cancel();
  return [
    {
      type: "text",
      text: `Download canceled: ${active[index].source?.url || "unknown"}`,
    },
  ];
}

async function removeDownload(args) {
  const { index = 0 } = args;
  const list = await lazy.Downloads.getList(lazy.Downloads.ALL);
  const downloads = await list.getAll();

  const stopped = downloads.filter(d => d.stopped);
  if (index >= stopped.length) {
    return [{ type: "text", text: "No completed download at that index" }];
  }

  await list.remove(stopped[index]);
  return [{ type: "text", text: "Download entry removed" }];
}

async function clearFinishedDownloads() {
  const list = await lazy.Downloads.getList(lazy.Downloads.ALL);
  await list.removeFinished();
  return [{ type: "text", text: "Finished downloads cleared" }];
}

async function getDownloadSummary() {
  const list = await lazy.Downloads.getList(lazy.Downloads.ALL);
  const downloads = await list.getAll();

  const active = downloads.filter(d => !d.stopped);
  const completed = downloads.filter(d => d.succeeded);
  const failed = downloads.filter(
    d => d.stopped && !d.succeeded && !d.canceled
  );
  const canceled = downloads.filter(d => d.canceled);

  let totalCurrentBytes = 0;
  let totalTotalBytes = 0;
  for (const d of active) {
    totalCurrentBytes += d.currentBytes;
    totalTotalBytes += d.totalBytes;
  }

  return [
    {
      type: "text",
      text: JSON.stringify(
        {
          total: downloads.length,
          active: active.length,
          completed: completed.length,
          failed: failed.length,
          canceled: canceled.length,
          activeProgress:
            totalTotalBytes > 0
              ? Math.round((totalCurrentBytes / totalTotalBytes) * 100)
              : undefined,
        },
        null,
        2
      ),
    },
  ];
}

export const DownloadTools = {
  tools: [
    {
      name: "downloads_list",
      description: "List recent downloads with their status and progress",
      inputSchema: {
        type: "object",
        properties: {
          count: {
            type: "integer",
            description: "Max downloads to return (default: 50)",
          },
        },
      },
      handler: listDownloads,
    },
    {
      name: "downloads_start",
      description: "Start a new file download",
      inputSchema: {
        type: "object",
        properties: {
          url: { type: "string", description: "URL to download" },
          filename: {
            type: "string",
            description: "Target filename (saved to Downloads folder)",
          },
        },
        required: ["url"],
      },
      handler: startDownload,
    },
    {
      name: "downloads_cancel",
      description:
        "Cancel an active download by index (0 = most recent active)",
      inputSchema: {
        type: "object",
        properties: {
          index: {
            type: "integer",
            description: "Index of active download to cancel (default: 0)",
          },
        },
      },
      handler: cancelDownload,
    },
    {
      name: "downloads_remove",
      description: "Remove a completed download entry from the list",
      inputSchema: {
        type: "object",
        properties: {
          index: {
            type: "integer",
            description: "Index of stopped download to remove (default: 0)",
          },
        },
      },
      handler: removeDownload,
    },
    {
      name: "downloads_clear_finished",
      description: "Remove all finished downloads from the list",
      inputSchema: { type: "object", properties: {} },
      handler: clearFinishedDownloads,
    },
    {
      name: "downloads_summary",
      description: "Get a summary of download counts and overall progress",
      inputSchema: { type: "object", properties: {} },
      handler: getDownloadSummary,
    },
  ],
};
