import * as path from "node:path";
import * as fs from "node:fs";
import type { RouteKind } from "./types.js";

// ---------------------------------------------------------------------------
// resolveRoute
// ---------------------------------------------------------------------------

/**
 * Classify an incoming request URL into a RouteKind.
 *
 * Rules (in priority order):
 * 1. `/events`           → SSE stream endpoint
 * 2. `/`                 → index page
 * 3. Path traversal      → not_found (security)
 * 4. Ends with `.md`     → markdown file
 * 5. File exists on disk → static file
 * 6. Otherwise           → not_found
 */
export function resolveRoute(
  requestUrl: string,
  watchDirectory: string
): RouteKind {
  // Parse URL safely; fall back to not_found for unparseable input
  let urlPath: string;
  try {
    urlPath = new URL(requestUrl, "http://localhost").pathname;
  } catch {
    return { kind: "not_found", requestPath: requestUrl };
  }

  // SSE endpoint
  if (urlPath === "/events") {
    return { kind: "sse" };
  }

  // Index page
  if (urlPath === "/") {
    return { kind: "index" };
  }

  // Decode percent-encoded characters (e.g. %20 → space)
  let decodedPath: string;
  try {
    decodedPath = decodeURIComponent(urlPath);
  } catch {
    return { kind: "not_found", requestPath: urlPath };
  }

  // Resolve the path against watchDirectory (strip the leading slash first)
  const relativePart = decodedPath.slice(1); // remove leading "/"
  const resolvedPath = path.resolve(watchDirectory, relativePart);

  // Path traversal guard: resolved path must remain inside watchDirectory.
  // Append path.sep to watchDirectory so that a directory whose name is a
  // prefix of another directory is not falsely accepted.
  const normalizedWatch = watchDirectory.endsWith(path.sep)
    ? watchDirectory
    : watchDirectory + path.sep;

  if (
    resolvedPath !== watchDirectory &&
    !resolvedPath.startsWith(normalizedWatch)
  ) {
    return { kind: "not_found", requestPath: urlPath };
  }

  // Markdown file
  if (decodedPath.endsWith(".md")) {
    return { kind: "markdown", filePath: resolvedPath };
  }

  // Static file (only if it actually exists)
  if (fs.existsSync(resolvedPath)) {
    return { kind: "static", filePath: resolvedPath };
  }

  return { kind: "not_found", requestPath: urlPath };
}

// ---------------------------------------------------------------------------
// generateIndexPage
// ---------------------------------------------------------------------------

/**
 * Build an HTML index page that lists all Markdown files with links.
 *
 * @param files         Absolute file paths inside watchDirectory
 * @param watchDirectory Absolute path to the watched directory
 */
export function generateIndexPage(
  files: string[],
  watchDirectory: string
): string {
  let bodyContent: string;

  if (files.length === 0) {
    bodyContent = `
    <p class="empty-notice">No Markdown files found in the watch directory.</p>`;
  } else {
    const listItems = files
      .map((filePath) => {
        // Build a root-relative URL from the file's path
        const relative = path.relative(watchDirectory, filePath);
        // Ensure forward slashes on all platforms
        const href = "/" + relative.split(path.sep).join("/");
        const label = escapeHtml(relative);
        return `      <li><a href="${escapeHtmlAttr(href)}">${label}</a></li>`;
      })
      .join("\n");

    bodyContent = `
    <ul class="file-list">
${listItems}
    </ul>`;
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Markdown Files — ${escapeHtml(watchDirectory)}</title>
  <link rel="stylesheet" href="/style.css" />
</head>
<body>
  <h1>Markdown Files</h1>
  <p class="watch-dir">Watch directory: <code>${escapeHtml(watchDirectory)}</code></p>
  ${bodyContent.trimStart()}
  <script>
    const evtSource = new EventSource('/events');
    evtSource.addEventListener('message', (e) => {
      if (e.data === 'reload') window.location.reload();
    });
  </script>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// generateErrorPage
// ---------------------------------------------------------------------------

/**
 * Build a minimal HTML error page.
 *
 * @param statusCode HTTP status code (e.g. 404, 500)
 * @param message    Human-readable description of the error
 */
export function generateErrorPage(
  statusCode: number,
  message: string
): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${statusCode} Error</title>
</head>
<body>
  <h1>${statusCode} Error</h1>
  <p>${escapeHtml(message)}</p>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Escape text for HTML element content. */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Escape text for use inside an HTML attribute value (double-quoted). */
function escapeHtmlAttr(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}
