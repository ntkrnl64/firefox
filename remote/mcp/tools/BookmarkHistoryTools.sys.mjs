/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const lazy = {};

ChromeUtils.defineESModuleGetters(lazy, {
  Bookmarks: "resource://gre/modules/Bookmarks.sys.mjs",
  PlacesUtils: "resource://gre/modules/PlacesUtils.sys.mjs",
});

function getActiveBrowser() {
  const win = Services.wm.getMostRecentBrowserWindow();
  if (!win?.gBrowser) {
    throw new Error("No browser window available");
  }
  return win.gBrowser.selectedBrowser;
}

function bookmarkToJSON(bm) {
  return {
    guid: bm.guid,
    title: bm.title || "",
    url: bm.url?.href || bm.url || undefined,
    type: bm.type,
    parentGuid: bm.parentGuid,
    index: bm.index,
    dateAdded: bm.dateAdded?.toISOString(),
  };
}

async function addBookmark(args) {
  const { url, title, parentGuid } = args;

  const browser = getActiveBrowser();
  const bookmarkUrl = url || browser.currentURI.spec;
  const bookmarkTitle = title || browser.contentTitle || bookmarkUrl;

  const bm = await lazy.Bookmarks.insert({
    parentGuid: parentGuid || lazy.Bookmarks.unfiledGuid,
    url: bookmarkUrl,
    title: bookmarkTitle,
    type: lazy.Bookmarks.TYPE_BOOKMARK,
  });

  return [{ type: "text", text: JSON.stringify(bookmarkToJSON(bm), null, 2) }];
}

async function removeBookmark(args) {
  const { guid } = args;
  if (!guid) {
    throw new Error("guid is required");
  }
  await lazy.Bookmarks.remove(guid);
  return [{ type: "text", text: `Bookmark ${guid} removed` }];
}

async function searchBookmarks(args) {
  const { query } = args;
  if (!query) {
    throw new Error("query is required");
  }
  const results = await lazy.Bookmarks.search({ query });
  return [
    {
      type: "text",
      text: JSON.stringify(results.map(bookmarkToJSON), null, 2),
    },
  ];
}

async function listBookmarks(args) {
  const { folder = "toolbar", count = 50 } = args;

  const folderGuids = {
    toolbar: lazy.Bookmarks.toolbarGuid,
    menu: lazy.Bookmarks.menuGuid,
    unfiled: lazy.Bookmarks.unfiledGuid,
    mobile: lazy.Bookmarks.mobileGuid,
  };

  const parentGuid = folderGuids[folder] || folder;
  const results = [];

  await lazy.Bookmarks.fetch({ parentGuid }, bm => {
    if (results.length < count) {
      results.push(bookmarkToJSON(bm));
    }
  });

  return [{ type: "text", text: JSON.stringify(results, null, 2) }];
}

async function getRecentBookmarks(args) {
  const { count = 20 } = args;
  const results = await lazy.Bookmarks.getRecent(count);
  return [
    {
      type: "text",
      text: JSON.stringify(results.map(bookmarkToJSON), null, 2),
    },
  ];
}

async function searchHistory(args) {
  const { query, count = 50 } = args;
  if (!query) {
    throw new Error("query is required");
  }

  const db = await lazy.PlacesUtils.promiseDBConnection();
  const rows = await db.executeCached(
    `SELECT url, title, visit_count, last_visit_date
     FROM moz_places
     WHERE (url LIKE :query OR title LIKE :query)
       AND last_visit_date IS NOT NULL
     ORDER BY last_visit_date DESC
     LIMIT :limit`,
    { query: `%${query}%`, limit: count }
  );

  const results = rows.map(row => ({
    url: row.getResultByName("url"),
    title: row.getResultByName("title"),
    visitCount: row.getResultByName("visit_count"),
    lastVisit: new Date(
      row.getResultByName("last_visit_date") / 1000
    ).toISOString(),
  }));

  return [{ type: "text", text: JSON.stringify(results, null, 2) }];
}

async function getRecentHistory(args) {
  const { count = 50 } = args;

  const db = await lazy.PlacesUtils.promiseDBConnection();
  const rows = await db.executeCached(
    `SELECT url, title, visit_count, last_visit_date
     FROM moz_places
     WHERE last_visit_date IS NOT NULL
     ORDER BY last_visit_date DESC
     LIMIT :limit`,
    { limit: count }
  );

  const results = rows.map(row => ({
    url: row.getResultByName("url"),
    title: row.getResultByName("title"),
    visitCount: row.getResultByName("visit_count"),
    lastVisit: new Date(
      row.getResultByName("last_visit_date") / 1000
    ).toISOString(),
  }));

  return [{ type: "text", text: JSON.stringify(results, null, 2) }];
}

async function deleteHistoryUrl(args) {
  const { url } = args;
  if (!url) {
    throw new Error("url is required");
  }

  const { History: historyService } = ChromeUtils.importESModule(
    "resource://gre/modules/History.sys.mjs"
  );
  const removed = await historyService.remove(url);
  return [
    {
      type: "text",
      text: removed
        ? `Removed ${url} from history`
        : "URL not found in history",
    },
  ];
}

async function deleteHistoryRange(args) {
  const { startDate, endDate } = args;

  const { History: historyService } = ChromeUtils.importESModule(
    "resource://gre/modules/History.sys.mjs"
  );

  const filter = {};
  if (startDate) {
    filter.beginDate = new Date(startDate);
  }
  if (endDate) {
    filter.endDate = new Date(endDate);
  }

  if (!filter.beginDate && !filter.endDate) {
    throw new Error("At least one of startDate or endDate is required");
  }

  const removed = await historyService.removeVisitsByFilter(filter);
  return [
    {
      type: "text",
      text: removed ? "History entries removed" : "No matching history found",
    },
  ];
}

async function clearAllHistory() {
  const { History: historyService } = ChromeUtils.importESModule(
    "resource://gre/modules/History.sys.mjs"
  );
  await historyService.clear();
  return [{ type: "text", text: "All history cleared" }];
}

export const BookmarkHistoryTools = {
  tools: [
    {
      name: "bookmark_add",
      description: "Bookmark the current page or a specific URL",
      inputSchema: {
        type: "object",
        properties: {
          url: {
            type: "string",
            description: "URL to bookmark (default: current page)",
          },
          title: {
            type: "string",
            description: "Bookmark title (default: page title)",
          },
          parentGuid: {
            type: "string",
            description: "Parent folder GUID (default: Other Bookmarks)",
          },
        },
      },
      handler: addBookmark,
    },
    {
      name: "bookmark_remove",
      description: "Remove a bookmark by its GUID",
      inputSchema: {
        type: "object",
        properties: {
          guid: { type: "string", description: "Bookmark GUID to remove" },
        },
        required: ["guid"],
      },
      handler: removeBookmark,
    },
    {
      name: "bookmark_search",
      description: "Search bookmarks by title or URL",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search query" },
        },
        required: ["query"],
      },
      handler: searchBookmarks,
    },
    {
      name: "bookmark_list",
      description: "List bookmarks in a folder",
      inputSchema: {
        type: "object",
        properties: {
          folder: {
            type: "string",
            enum: ["toolbar", "menu", "unfiled", "mobile"],
            description: "Folder name or GUID (default: toolbar)",
          },
          count: { type: "integer", description: "Max results (default: 50)" },
        },
      },
      handler: listBookmarks,
    },
    {
      name: "bookmark_recent",
      description: "Get most recently added bookmarks",
      inputSchema: {
        type: "object",
        properties: {
          count: {
            type: "integer",
            description: "Number of bookmarks (default: 20)",
          },
        },
      },
      handler: getRecentBookmarks,
    },
    {
      name: "history_search",
      description: "Search browsing history by URL or title",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search query" },
          count: { type: "integer", description: "Max results (default: 50)" },
        },
        required: ["query"],
      },
      handler: searchHistory,
    },
    {
      name: "history_recent",
      description: "Get most recently visited pages",
      inputSchema: {
        type: "object",
        properties: {
          count: {
            type: "integer",
            description: "Number of entries (default: 50)",
          },
        },
      },
      handler: getRecentHistory,
    },
    {
      name: "history_delete_url",
      description: "Delete a specific URL from history",
      inputSchema: {
        type: "object",
        properties: {
          url: { type: "string", description: "URL to remove from history" },
        },
        required: ["url"],
      },
      handler: deleteHistoryUrl,
    },
    {
      name: "history_delete_range",
      description: "Delete history entries in a date range",
      inputSchema: {
        type: "object",
        properties: {
          startDate: { type: "string", description: "Start date (ISO 8601)" },
          endDate: { type: "string", description: "End date (ISO 8601)" },
        },
      },
      handler: deleteHistoryRange,
    },
    {
      name: "history_clear",
      description: "Clear all browsing history",
      inputSchema: { type: "object", properties: {} },
      handler: clearAllHistory,
    },
  ],
};
