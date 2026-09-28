import * as http from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import * as fs from "node:fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";

import type { ServerConfig, HtmlCache } from "./types.js";
import { getContentType } from "./types.js";
import {
  resolveRoute,
  generateIndexPage,
  generateErrorPage,
} from "./router.js";
import { parseMarkdown, wrapHtml } from "./parser.js";
import { SseManager } from "./sse.js";
import { startWatcher } from "./watcher.js";

const HTML_CONTENT_TYPE = "text/html; charset=utf-8";

/**
 * Create the HTTP request handler used by the md-to-html-server.
 *
 * The returned function is suitable for passing directly to
 * `http.createServer(...)`. It routes each request via {@link resolveRoute}
 * and serves Markdown (converted to HTML), the file index, static assets and
 * the Server-Sent Events (SSE) live-reload stream.
 *
 * All I/O is wrapped in try/catch so a failure never crashes the process:
 * conversion / read failures become HTTP 500, missing files become HTTP 404.
 * The HTML cache is only mutated on a successful Markdown conversion — an
 * error leaves any existing cache entry untouched (Requirement 3.6).
 */
export function createRequestHandler(
  config: ServerConfig,
  cache: HtmlCache,
  sseManager: SseManager
): (req: IncomingMessage, res: ServerResponse) => void {
  return function handleRequest(
    req: IncomingMessage,
    res: ServerResponse
  ): void {
    const requestUrl = req.url ?? "/";
    const route = resolveRoute(requestUrl, config.watchDirectory);

    switch (route.kind) {
      case "index":
        handleIndex(config, res);
        return;

      case "markdown":
        handleMarkdown(route.filePath, cache, res);
        return;

      case "static":
        handleStatic(route.filePath, res);
        return;

      case "sse":
        handleSse(req, res, sseManager);
        return;

      case "not_found":
      default:
        respondNotFound(res, route.kind === "not_found" ? route.requestPath : requestUrl);
        return;
    }
  };
}

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------

/** Render the index page listing all Markdown files under the watch directory. */
function handleIndex(config: ServerConfig, res: ServerResponse): void {
  let files: string[];
  try {
    files = listMarkdownFiles(config.watchDirectory);
  } catch (e: unknown) {
    respondServerError(res, errorMessage(e));
    return;
  }

  const html = generateIndexPage(files, config.watchDirectory);
  res.writeHead(200, { "Content-Type": HTML_CONTENT_TYPE });
  res.end(html);
}

/**
 * Serve a Markdown file as HTML.
 *
 * On a cache hit the cached HTML is returned directly. On a miss the file is
 * read and converted; a successful conversion is stored in the cache before
 * responding. A read or conversion failure yields HTTP 500 and does NOT touch
 * the cache; a missing file yields HTTP 404.
 */
function handleMarkdown(
  filePath: string,
  cache: HtmlCache,
  res: ServerResponse
): void {
  const cached = cache.get(filePath);
  if (cached !== undefined) {
    res.writeHead(200, { "Content-Type": HTML_CONTENT_TYPE });
    res.end(cached);
    return;
  }

  let source: string;
  try {
    source = fs.readFileSync(filePath, "utf-8");
  } catch (e: unknown) {
    if (isNotFoundError(e)) {
      respondNotFound(res, filePath);
    } else {
      respondServerError(res, errorMessage(e));
    }
    return;
  }

  const parsed = parseMarkdown(source);
  if (!parsed.ok) {
    // Conversion error: respond 500 without mutating the cache.
    respondServerError(res, parsed.error.message);
    return;
  }

  const title = path.basename(filePath);
  const html = wrapHtml(parsed.html, title);
  cache.set(filePath, html);

  res.writeHead(200, { "Content-Type": HTML_CONTENT_TYPE });
  res.end(html);
}

/**
 * Serve a static asset. The raw bytes are returned unchanged with a
 * Content-Type derived from the file extension. A missing file yields 404.
 */
function handleStatic(filePath: string, res: ServerResponse): void {
  let bytes: Buffer;
  try {
    bytes = fs.readFileSync(filePath);
  } catch (e: unknown) {
    if (isNotFoundError(e)) {
      respondNotFound(res, filePath);
    } else {
      respondServerError(res, errorMessage(e));
    }
    return;
  }

  res.writeHead(200, { "Content-Type": getContentType(filePath) });
  res.end(bytes);
}

/**
 * Establish an SSE stream for live-reload. Sends the streaming headers, an
 * initial flush, registers the client with the SseManager and keeps the
 * connection open. The client is pruned when the request closes.
 */
function handleSse(
  req: IncomingMessage,
  res: ServerResponse,
  sseManager: SseManager
): void {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });

  // Flush headers so the browser opens the stream immediately.
  res.write(": connected\n\n");

  const id = randomUUID();
  sseManager.addClient({ id, response: res });

  req.on("close", () => {
    sseManager.removeClient(id);
  });
}

// ---------------------------------------------------------------------------
// Response helpers
// ---------------------------------------------------------------------------

function respondNotFound(res: ServerResponse, requestPath: string): void {
  const html = generateErrorPage(404, `Not Found: ${requestPath}`);
  res.writeHead(404, { "Content-Type": HTML_CONTENT_TYPE });
  res.end(html);
}

function respondServerError(res: ServerResponse, message: string): void {
  const html = generateErrorPage(500, message);
  res.writeHead(500, { "Content-Type": HTML_CONTENT_TYPE });
  res.end(html);
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Recursively enumerate all `.md` files under `watchDirectory`, returning
 * absolute paths. Symbolic links are not followed.
 */
function listMarkdownFiles(watchDirectory: string): string[] {
  const results: string[] = [];

  const walk = (dir: string): void => {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile() && entry.name.endsWith(".md")) {
        results.push(full);
      }
    }
  };

  walk(watchDirectory);
  return results;
}

/** True when a caught error indicates a missing file/directory (ENOENT). */
function isNotFoundError(e: unknown): boolean {
  return (
    typeof e === "object" &&
    e !== null &&
    "code" in e &&
    (e as { code?: unknown }).code === "ENOENT"
  );
}

/** Extract a human-readable message from an unknown thrown value. */
function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

// ---------------------------------------------------------------------------
// startHttpServer
// ---------------------------------------------------------------------------

/**
 * Boot the md-to-html-server for the given configuration.
 *
 * Wires together the HTML cache, the SSE manager (for live-reload), the HTTP
 * request handler and the file watcher, then starts listening on the
 * configured port.
 *
 * File-watcher behavior:
 * - `change` / `add` on a Markdown file re-reads and re-converts the file,
 *   updates the cache on success and broadcasts a `reload` event to all SSE
 *   clients (Requirements 3.1, 3.2, 3.4, 4.1, 4.2). A read or conversion
 *   failure is logged and leaves the cache untouched (Requirement 3.6).
 * - `unlink` removes the corresponding cache entry and broadcasts a reload so
 *   any open browser refreshes (Requirement 3.3).
 *
 * If the configured port is already in use (`EADDRINUSE`) an error is written
 * to the console and the process exits with a non-zero status
 * (Requirement 5.10).
 *
 * @param config Fully resolved server configuration.
 * @returns The listening `http.Server` instance.
 */
export function startHttpServer(config: ServerConfig): Server {
  const cache: HtmlCache = new Map();
  const sseManager = new SseManager();
  sseManager.startHeartbeat();

  const handler = createRequestHandler(config, cache, sseManager);
  const server = http.createServer(handler);

  // Re-convert a Markdown file and refresh the cache, then notify browsers.
  const rebuild = (filePath: string): void => {
    let source: string;
    try {
      source = fs.readFileSync(filePath, "utf-8");
    } catch (e: unknown) {
      // Read failure: log and leave the cache unchanged (Requirement 3.6).
      console.error(`Failed to read ${filePath}: ${errorMessage(e)}`);
      return;
    }

    const parsed = parseMarkdown(source);
    if (!parsed.ok) {
      // Conversion failure: log and leave the cache unchanged (Requirement 3.6).
      console.error(
        `Failed to convert ${filePath}: ${parsed.error.message}`
      );
      return;
    }

    const html = wrapHtml(parsed.html, path.basename(filePath));
    cache.set(filePath, html);
    sseManager.broadcast("reload");
  };

  startWatcher(config.watchDirectory, {
    onChange: async (filePath: string): Promise<void> => {
      rebuild(filePath);
    },
    onAdd: async (filePath: string): Promise<void> => {
      rebuild(filePath);
    },
    onUnlink: (filePath: string): void => {
      cache.delete(filePath);
      sseManager.broadcast("reload");
    },
  });

  server.on("error", (err: NodeJS.ErrnoException): void => {
    if (err.code === "EADDRINUSE") {
      console.error(
        `Port ${config.port} is already in use. Stop the process using it or configure a different port.`
      );
      process.exit(1);
    }
    console.error(`Server error: ${err.message}`);
    process.exit(1);
  });

  server.listen(config.port);

  return server;
}
