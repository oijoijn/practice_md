import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { parseMarkdown } from "../../src/parser.js";
import { prettyPrint } from "../../src/pretty-printer.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Collapse cosmetic whitespace differences so structurally-identical HTML
 * compares equal. We trim, collapse runs of whitespace between/around tags,
 * and drop whitespace that sits purely between two tags.
 */
function normalizeHtml(html: string): string {
  return html
    .replace(/\r\n/g, "\n")
    .replace(/>\s+</g, "><") // whitespace between tags is not significant here
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Text content that is safe to embed inside Markdown inline constructs
 * without accidentally introducing extra markup. We exclude characters that
 * carry Markdown meaning (`#`, `*`, `_`, backtick, `~`, `|`, `[`, `]`,
 * `<`, `>`, `\`, `-`) plus newlines, and require at least one word char so
 * the construct is non-empty after marked trims it.
 */
const safeInlineText = fc
  .string({ minLength: 1, maxLength: 20 })
  .map((s) => s.replace(/[#*_`~|\[\]<>\\\-\r\n]/g, "").trim())
  .filter((s) => s.length > 0 && /[A-Za-z0-9]/.test(s));

// ---------------------------------------------------------------------------
// Property 4: GFM 構文の HTML 変換
// ---------------------------------------------------------------------------
// Feature: md-to-html-server, Property 4: GFM 構文の HTML 変換
// Validates: Requirements 2.1
//
// For any Markdown containing a given GFM construct, parseMarkdown returns
// HTML that contains the corresponding tag. We generate one construct at a
// time from safe text and assert the expected tag appears in the output.
describe("Property 4: GFM 構文の HTML 変換", () => {
  it("headings (# .. ######) produce <h1>..<h6>", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 6 }),
        safeInlineText,
        (level, text) => {
          const md = `${"#".repeat(level)} ${text}`;
          const result = parseMarkdown(md);
          expect(result.ok).toBe(true);
          if (result.ok) {
            expect(result.html).toContain(`<h${level}`);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it("unordered list items produce <ul> / <li>", () => {
    fc.assert(
      fc.property(
        fc.array(safeInlineText, { minLength: 1, maxLength: 5 }),
        (items) => {
          const md = items.map((t) => `- ${t}`).join("\n");
          const result = parseMarkdown(md);
          expect(result.ok).toBe(true);
          if (result.ok) {
            expect(result.html).toContain("<ul");
            expect(result.html).toContain("<li");
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it("fenced code blocks produce <pre> / <code>", () => {
    fc.assert(
      fc.property(safeInlineText, (text) => {
        const md = "```\n" + text + "\n```";
        const result = parseMarkdown(md);
        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.html).toContain("<pre");
          expect(result.html).toContain("<code");
        }
      }),
      { numRuns: 100 },
    );
  });

  it("strikethrough (~~text~~) produces <del>", () => {
    fc.assert(
      fc.property(safeInlineText, (text) => {
        const md = `~~${text}~~`;
        const result = parseMarkdown(md);
        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.html).toContain("<del");
        }
      }),
      { numRuns: 100 },
    );
  });

  it("GFM tables produce <table> / <th> / <td>", () => {
    fc.assert(
      fc.property(
        fc.array(safeInlineText, { minLength: 1, maxLength: 3 }),
        fc.array(safeInlineText, { minLength: 1, maxLength: 3 }),
        (headers, cells) => {
          // Ensure equal column counts by using the shorter length.
          const cols = Math.min(headers.length, cells.length);
          const h = headers.slice(0, cols);
          const c = cells.slice(0, cols);
          const md = [
            `| ${h.join(" | ")} |`,
            `| ${h.map(() => "---").join(" | ")} |`,
            `| ${c.join(" | ")} |`,
          ].join("\n");
          const result = parseMarkdown(md);
          expect(result.ok).toBe(true);
          if (result.ok) {
            expect(result.html).toContain("<table");
            expect(result.html).toContain("<th");
            expect(result.html).toContain("<td");
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 5: ラウンドトリップ安定性（Markdown → HTML → Markdown → HTML）
// ---------------------------------------------------------------------------
// Feature: md-to-html-server, Property 5: ラウンドトリップ安定性
// Validates: Requirements 2.4, 2.5
//
// Design note: a single MD→HTML→MD→HTML pass is not guaranteed to be exactly
// stable for fully arbitrary Markdown (turndown normalizes constructs, e.g.
// emphasis markers, list markers, heading styles). So we assert the property
// the design actually requires: idempotence of the round-trip. We take the
// canonical form once (html1 → md1), then show that converting md1 forward
// and back yields the SAME HTML again. This is the meaningful "2回目以降の
// 変換は冪等である" guarantee from Property 5.
describe("Property 5: ラウンドトリップ安定性", () => {
  // Generators for a small but representative Markdown subset.
  const headingLine = fc
    .tuple(fc.integer({ min: 1, max: 6 }), safeInlineText)
    .map(([lvl, t]) => `${"#".repeat(lvl)} ${t}`);
  const paragraphLine = safeInlineText;
  const boldLine = safeInlineText.map((t) => `**${t}**`);
  const italicLine = safeInlineText.map((t) => `*${t}*`);
  const listBlock = fc
    .array(safeInlineText, { minLength: 1, maxLength: 4 })
    .map((items) => items.map((t) => `- ${t}`).join("\n"));

  const markdownBlock = fc.oneof(
    headingLine,
    paragraphLine,
    boldLine,
    italicLine,
    listBlock,
  );

  const markdownDoc = fc
    .array(markdownBlock, { minLength: 1, maxLength: 6 })
    .map((blocks) => blocks.join("\n\n"));

  it("round-trip is idempotent (stable after the first canonicalization)", () => {
    fc.assert(
      fc.property(markdownDoc, (md) => {
        const html1 = parseMarkdown(md);
        if (!html1.ok) return true; // skip inputs the parser rejects

        const printed1 = prettyPrint(html1.html);
        if (!printed1.ok) return true;

        // Canonical HTML obtained after one full round-trip.
        const html2 = parseMarkdown(printed1.markdown);
        if (!html2.ok) return true;

        // Apply the round-trip once more starting from the canonical markdown.
        const printed2 = prettyPrint(html2.html);
        if (!printed2.ok) return true;

        const html3 = parseMarkdown(printed2.markdown);
        if (!html3.ok) return true;

        // html2 and html3 must be structurally identical: the round-trip has
        // reached a fixed point (idempotence).
        expect(normalizeHtml(html3.html)).toBe(normalizeHtml(html2.html));
        return true;
      }),
      { numRuns: 100 },
    );
  });
});
