const { app, BrowserWindow, session, protocol } = require("electron");
const path = require("node:path");
const fs = require("node:fs");

// Register custom protocol privileges before app is ready
protocol.registerSchemesAsPrivileged([
  {
    scheme: "xband-tile",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
    },
  },
]);

const CSP_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval' blob:",
  "worker-src 'self' blob:",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: xband-tile:",
  "connect-src 'self' http://localhost:* ws://localhost:* http://127.0.0.1:* ws://127.0.0.1:* blob: data: xband-tile:",
  "font-src 'self' data:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const TILES_ROOT = path.resolve(__dirname, "../data/tiles");

const MIME_TYPES = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".pbf": "application/x-protobuf",
  ".mvt": "application/x-protobuf",
  ".pmtiles": "application/octet-stream",
};

function createWindow() {
  const window = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1024,
    minHeight: 700,
    backgroundColor: "#080a0d",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));

  window.webContents.on("will-navigate", (event, navigationUrl) => {
    try {
      const parsed = new URL(navigationUrl);
      const isAllowed =
        parsed.protocol === "file:" ||
        ((parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1") &&
          (parsed.protocol === "http:" || parsed.protocol === "https:"));
      if (!isAllowed) {
        event.preventDefault();
      }
    } catch {
      event.preventDefault();
    }
  });

  window.loadFile(path.join(app.getAppPath(), "dist", "index.html"));
}

app.whenReady().then(() => {
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [CSP_POLICY],
      },
    });
  });

  // Secure read-only offline air-gap tile protocol handler strictly confined to data/tiles/
  protocol.handle("xband-tile", async (request) => {
    try {
      const rawUrl = request.url;
      const lowerRaw = rawUrl.toLowerCase();
      if (
        rawUrl.includes("..") ||
        lowerRaw.includes("%2e%2e") ||
        lowerRaw.includes("%2e") ||
        rawUrl.includes("\\") ||
        lowerRaw.includes("%5c") ||
        rawUrl.includes("\0") ||
        lowerRaw.includes("%00")
      ) {
        return new Response("Bad Request: Path traversal detected", { status: 400 });
      }

      const parsed = new URL(rawUrl);
      const tileset = parsed.hostname || parsed.host;
      if (!tileset || !/^[a-zA-Z0-9_-]+$/.test(tileset)) {
        return new Response("Bad Request: Invalid tileset identifier", { status: 400 });
      }

      const cleanPath = parsed.pathname.replace(/^\/+/, "");
      const targetPath = path.resolve(TILES_ROOT, tileset, cleanPath);

      // Strict normalized prefix containment check
      const normalizedRoot = path.normalize(TILES_ROOT) + path.sep;
      const normalizedTarget = path.normalize(targetPath);

      if (!normalizedTarget.startsWith(normalizedRoot)) {
        return new Response("Bad Request: Path traversal outside tiles directory", { status: 400 });
      }

      // Strict realpath symlink containment check
      const realRoot = await fs.promises.realpath(TILES_ROOT).catch(() => path.resolve(TILES_ROOT));
      let realTarget;
      try {
        realTarget = await fs.promises.realpath(normalizedTarget);
      } catch {
        return new Response("Not Found", { status: 404 });
      }

      if (!realTarget.startsWith(realRoot + path.sep)) {
        return new Response("Forbidden: Symlink traversal outside tiles directory", { status: 403 });
      }

      let stats;
      try {
        stats = await fs.promises.stat(realTarget);
      } catch {
        return new Response("Not Found", { status: 404 });
      }

      if (!stats.isFile()) {
        return new Response("Not Found", { status: 404 });
      }

      const ext = path.extname(realTarget).toLowerCase();
      const mimeType = MIME_TYPES[ext] || "application/octet-stream";
      const fileSize = stats.size;

      // RFC 9110 Range Header handling
      const rangeHeader = request.headers.get("range") || request.headers.get("Range");
      if (rangeHeader && rangeHeader.startsWith("bytes=")) {
        const rangeSpec = rangeHeader.slice(6).trim();
        // Support single range: bytes=start-end, bytes=start-, bytes=-suffixLength
        const parts = rangeSpec.split("-");
        if (parts.length === 2) {
          const rawStart = parts[0].trim();
          const rawEnd = parts[1].trim();

          let start;
          let end;

          if (rawStart === "") {
            // Suffix range: bytes=-suffixLength
            const suffixLength = parseInt(rawEnd, 10);
            if (isNaN(suffixLength) || suffixLength <= 0 || fileSize === 0) {
              return new Response(null, {
                status: 416,
                headers: {
                  "Content-Range": `bytes */${fileSize}`,
                  "Accept-Ranges": "bytes",
                },
              });
            }
            start = Math.max(0, fileSize - suffixLength);
            end = fileSize - 1;
          } else {
            start = parseInt(rawStart, 10);
            if (isNaN(start) || start < 0 || start >= fileSize) {
              return new Response(null, {
                status: 416,
                headers: {
                  "Content-Range": `bytes */${fileSize}`,
                  "Accept-Ranges": "bytes",
                },
              });
            }
            if (rawEnd === "") {
              // Open-ended range: bytes=start-
              end = fileSize - 1;
            } else {
              end = parseInt(rawEnd, 10);
              if (isNaN(end) || end < start) {
                return new Response(null, {
                  status: 416,
                  headers: {
                    "Content-Range": `bytes */${fileSize}`,
                    "Accept-Ranges": "bytes",
                  },
                });
              }
              if (end >= fileSize) {
                end = fileSize - 1;
              }
            }
          }

          const chunkLength = end - start + 1;
          const buf = Buffer.alloc(chunkLength);
          const fileHandle = await fs.promises.open(realTarget, "r");
          try {
            await fileHandle.read(buf, 0, chunkLength, start);
          } finally {
            await fileHandle.close();
          }

          return new Response(buf, {
            status: 206,
            headers: {
              "Content-Type": mimeType,
              "Content-Range": `bytes ${start}-${end}/${fileSize}`,
              "Content-Length": String(chunkLength),
              "Accept-Ranges": "bytes",
              "Cache-Control": "public, max-age=86400",
            },
          });
        }
      }

      // No range or unrecognized range: reject > 64 MB to prevent OOM on full reads
      if (fileSize > 64 * 1024 * 1024) {
        return new Response("Payload Too Large: File exceeds 64 MB for non-range requests", {
          status: 413,
          headers: { "Accept-Ranges": "bytes" },
        });
      }

      const buffer = await fs.promises.readFile(realTarget);
      return new Response(buffer, {
        status: 200,
        headers: {
          "Content-Type": mimeType,
          "Content-Length": String(fileSize),
          "Accept-Ranges": "bytes",
          "Cache-Control": "public, max-age=86400",
        },
      });
    } catch {
      return new Response("Internal Server Error", { status: 500 });
    }
  });

  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
