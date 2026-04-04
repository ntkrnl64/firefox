/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const lazy = {};

ChromeUtils.defineESModuleGetters(lazy, {
  print: "chrome://remote/content/shared/PDF.sys.mjs",
});

function getActiveBrowsingContext() {
  const win = Services.wm.getMostRecentBrowserWindow();
  if (!win?.gBrowser) {
    throw new Error("No browser window available");
  }
  return win.gBrowser.selectedBrowser.browsingContext;
}

async function printToPDF(args) {
  const {
    orientation = "portrait",
    scale = 1.0,
    background = false,
    pageWidth,
    pageHeight,
    marginTop,
    marginBottom,
    marginLeft,
    marginRight,
    pageRanges = [],
    shrinkToFit = true,
  } = args;

  const settings = lazy.print.addDefaultSettings({
    background,
    margin: {
      ...(marginTop !== undefined && { top: marginTop }),
      ...(marginBottom !== undefined && { bottom: marginBottom }),
      ...(marginLeft !== undefined && { left: marginLeft }),
      ...(marginRight !== undefined && { right: marginRight }),
    },
    orientation,
    page: {
      ...(pageWidth !== undefined && { width: pageWidth }),
      ...(pageHeight !== undefined && { height: pageHeight }),
    },
    pageRanges,
    scale,
    shrinkToFit,
  });

  const printSettings = lazy.print.getPrintSettings(settings);
  const bc = getActiveBrowsingContext();

  const binaryString = await lazy.print.printToBinaryString(bc, printSettings);
  const base64 = ChromeUtils.base64URLEncode(
    new Uint8Array([...binaryString].map(c => c.charCodeAt(0))),
    { pad: true }
  );

  return [
    {
      type: "text",
      text: JSON.stringify({
        message: "Page printed to PDF",
        sizeBytes: binaryString.length,
        base64,
      }),
    },
  ];
}

async function saveToPDF(args) {
  const {
    path,
    orientation = "portrait",
    scale = 1.0,
    background = false,
    shrinkToFit = true,
  } = args;

  if (!path) {
    throw new Error("path is required");
  }

  const settings = lazy.print.addDefaultSettings({
    background,
    orientation,
    scale,
    shrinkToFit,
  });

  const printSettings = lazy.print.getPrintSettings(settings);
  const bc = getActiveBrowsingContext();

  const binaryString = await lazy.print.printToBinaryString(bc, printSettings);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }

  await IOUtils.write(path, bytes);
  return [
    { type: "text", text: `PDF saved to ${path} (${bytes.length} bytes)` },
  ];
}

export const PrintTools = {
  tools: [
    {
      name: "page_print_pdf",
      description:
        "Print the active tab to PDF and return it as base64-encoded data",
      inputSchema: {
        type: "object",
        properties: {
          orientation: {
            type: "string",
            enum: ["portrait", "landscape"],
            description: "Page orientation (default: portrait)",
          },
          scale: {
            type: "number",
            description: "Scale factor 0.1-2.0 (default: 1.0)",
          },
          background: {
            type: "boolean",
            description: "Print background colors/images (default: false)",
          },
          pageWidth: {
            type: "number",
            description: "Page width in cm (default: 21.59)",
          },
          pageHeight: {
            type: "number",
            description: "Page height in cm (default: 27.94)",
          },
          marginTop: {
            type: "number",
            description: "Top margin in cm (default: 1.0)",
          },
          marginBottom: {
            type: "number",
            description: "Bottom margin in cm (default: 1.0)",
          },
          marginLeft: {
            type: "number",
            description: "Left margin in cm (default: 1.0)",
          },
          marginRight: {
            type: "number",
            description: "Right margin in cm (default: 1.0)",
          },
          pageRanges: {
            type: "array",
            items: { type: "string" },
            description: "Page ranges, e.g. ['1-3', '5']",
          },
          shrinkToFit: {
            type: "boolean",
            description: "Shrink content to fit page (default: true)",
          },
        },
      },
      handler: printToPDF,
    },
    {
      name: "page_save_pdf",
      description: "Save the active tab as a PDF file to disk",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", description: "File path to save the PDF" },
          orientation: {
            type: "string",
            enum: ["portrait", "landscape"],
            description: "Page orientation (default: portrait)",
          },
          scale: { type: "number", description: "Scale factor (default: 1.0)" },
          background: {
            type: "boolean",
            description: "Include background (default: false)",
          },
          shrinkToFit: {
            type: "boolean",
            description: "Shrink to fit (default: true)",
          },
        },
        required: ["path"],
      },
      handler: saveToPDF,
    },
  ],
};
