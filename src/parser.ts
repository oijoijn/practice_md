import { marked } from "marked";
import type { ParseResult } from "./types.js";

// Configure marked for synchronous GFM output
marked.setOptions({ async: false });

/**
 * Convert a Markdown string to HTML.
 *
 * Returns a ParseResult so callers never need to catch exceptions.
 */
export function parseMarkdown(input: unknown): ParseResult {
  // Reject null / undefined
  if (input === null || input === undefined) {
    return {
      ok: false,
      error: {
        kind: "null_input",
        message: "Input must be a string, but received null or undefined.",
      },
    };
  }

  // Reject binary data (Buffer inherits from Uint8Array in Node.js)
  if (input instanceof Uint8Array) {
    return {
      ok: false,
      error: {
        kind: "binary_input",
        message:
          "Input must be a string, but received binary data (Buffer / Uint8Array).",
      },
    };
  }

  // Only strings are accepted beyond this point
  if (typeof input !== "string") {
    return {
      ok: false,
      error: {
        kind: "null_input",
        message: `Input must be a string, but received ${typeof input}.`,
      },
    };
  }

  try {
    // marked.parse() is synchronous when async option is false.
    // The return type is `string | Promise<string>` in the type definitions,
    // but at runtime it is always a plain string here.
    const result = marked.parse(input, { async: false });
    const html = result as string;
    return { ok: true, html };
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      error: {
        kind: "conversion_error",
        message,
      },
    };
  }
}

/**
 * Wrap a raw HTML body fragment in a full HTML document.
 *
 * The document includes:
 * - A <link> to /style.css
 * - The supplied bodyHtml inside <body>
 * - A <script> that connects to /events (SSE) and reloads on a "reload" message
 */
export function wrapHtml(bodyHtml: string, title: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(title)}</title>
  <link rel="stylesheet" href="/style.css" />
</head>
<body>
${bodyHtml}
<script>
  const evtSource = new EventSource('/events');
  evtSource.addEventListener('message', (e) => {
    if (e.data === 'reload') window.location.reload();
  });
</script>
</body>
</html>`;
}

/** Minimal HTML-escape for use inside element text (title only). */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
