import { describe, it, expect } from "vitest";
import { prettyPrint } from "../../src/pretty-printer.js";

// Unit tests for Pretty_Printer (HTML → Markdown).
// _Requirements: 2.4_
//
// Assertions are matched against the actual turndown + turndown-plugin-gfm
// output produced by the configured service (headingStyle "atx",
// codeBlockStyle "fenced", bulletListMarker "-").

describe("prettyPrint", () => {
  it("round-trips an H1 heading to ATX '# Title'", () => {
    const result = prettyPrint("<h1>Title</h1>");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.markdown).toContain("# Title");
    }
  });

  it("round-trips an H2 heading to ATX '## Sub'", () => {
    const result = prettyPrint("<h2>Sub</h2>");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.markdown).toContain("## Sub");
    }
  });

  it("converts a <pre><code> block to a fenced code block", () => {
    const result = prettyPrint("<pre><code>const x = 1;</code></pre>");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.markdown).toContain("const x = 1;");
      expect(result.markdown).toContain("```");
    }
  });

  it("converts a GFM table to pipe table syntax", () => {
    const html =
      "<table>" +
      "<thead><tr><th>Name</th><th>Age</th></tr></thead>" +
      "<tbody><tr><td>Alice</td><td>30</td></tr></tbody>" +
      "</table>";
    const result = prettyPrint(html);
    expect(result.ok).toBe(true);
    if (result.ok) {
      // Pipe table syntax with header and data cell values.
      expect(result.markdown).toContain("|");
      expect(result.markdown).toContain("Name");
      expect(result.markdown).toContain("Age");
      expect(result.markdown).toContain("Alice");
      expect(result.markdown).toContain("30");
      // A GFM table has a header separator row of dashes.
      expect(result.markdown).toContain("---");
    }
  });

  it("converts an unordered list using the '-' bullet marker", () => {
    const result = prettyPrint("<ul><li>a</li><li>b</li></ul>");
    expect(result.ok).toBe(true);
    if (result.ok) {
      // bulletListMarker is "-"; turndown pads with spaces after the marker.
      expect(result.markdown).toMatch(/-\s+a/);
      expect(result.markdown).toMatch(/-\s+b/);
    }
  });

  it("converts <del> to GFM strikethrough tildes", () => {
    const result = prettyPrint("<del>gone</del>");
    expect(result.ok).toBe(true);
    if (result.ok) {
      // turndown-plugin-gfm emits single-tilde strikethrough: ~gone~
      expect(result.markdown).toContain("~gone~");
    }
  });

  it("converts <strong> to '**b**'", () => {
    const result = prettyPrint("<strong>b</strong>");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.markdown).toContain("**b**");
    }
  });

  it("converts <em> to emphasis markers ('_i_' or '*i*')", () => {
    const result = prettyPrint("<em>i</em>");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.markdown).toMatch(/[_*]i[_*]/);
    }
  });
});
