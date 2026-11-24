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

      if (!fs.existsSync(normalizedTarget)) {
        return new Response("Not Found", { status: 404 });
      }

      const ext = path.extname(normalizedTarget).toLowerCase();
      const mimeType = MIME_TYPES[ext] || "application/octet-stream";
      const buffer = fs.readFileSync(normalizedTarget);

      return new Response(buffer, {
        status: 200,
        headers: {
          "Content-Type": mimeType,
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
