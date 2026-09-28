import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";
import type { PrintResult } from "./types.js";

// Create a single shared TurndownService instance with GFM support.
// Options chosen for clean, round-trip-friendly Markdown output:
//   - headingStyle "atx"   → # Heading (easier to re-parse than setext underlines)
//   - codeBlockStyle "fenced" → ``` fences (preserves language info)
const _service = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
  bulletListMarker: "-",
});

// Register the full GFM plugin set (tables, strikethrough, task list items,
// highlighted code blocks).
_service.use(gfm);

/**
 * Convert an HTML string to GFM-compliant Markdown.
 *
 * Returns a PrintResult so callers never need to catch exceptions.
 *
 * @param html  The HTML string to convert.  May be a fragment or a full document.
 */
export function prettyPrint(html: string): PrintResult {
  try {
    const markdown = _service.turndown(html);
    return { ok: true, markdown };
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    return { ok: false, error: message };
  }
}
