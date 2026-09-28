import { describe, it, expect } from "vitest";
import { parseMarkdown, wrapHtml } from "../../src/parser.js";

// ---------------------------------------------------------------------------
// GFM conversion tests (Requirement 2.1)
// ---------------------------------------------------------------------------
describe("parseMarkdown — GFM conversions (Req 2.1)", () => {
  it("converts an H1 heading to <h1>", () => {
    const result = parseMarkdown("# H1");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.html).toContain("<h1");
  });

  it("converts an H2 heading to <h2>", () => {
    const result = parseMarkdown("## H2");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.html).toContain("<h2");
  });

  it("converts an unordered list to <ul>/<li>", () => {
    const result = parseMarkdown("- a\n- b");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.html).toContain("<ul");
      expect(result.html).toContain("<li");
    }
  });

  it("converts an ordered list to <ol>/<li>", () => {
    const result = parseMarkdown("1. a\n2. b");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.html).toContain("<ol");
      expect(result.html).toContain("<li");
    }
  });

  it("converts a fenced code block to <pre>/<code>", () => {
    const result = parseMarkdown("```\nconst x = 1;\n```");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.html).toContain("<pre>");
      expect(result.html).toContain("<code");
    }
  });

  it("converts inline code to <code>", () => {
    const result = parseMarkdown("`x`");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.html).toContain("<code");
  });

  it("converts a link to <a href>", () => {
    const result = parseMarkdown("[t](http://e.com)");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.html).toContain('<a href');
  });

  it("converts a GFM pipe table to <table>/<td>", () => {
    const md = "| a | b |\n| --- | --- |\n| 1 | 2 |";
    const result = parseMarkdown(md);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.html).toContain("<table");
      expect(result.html).toContain("<td");
    }
  });

  it("converts strikethrough to <del> (marked GFM output)", () => {
    const result = parseMarkdown("~~x~~");
    expect(result.ok).toBe(true);
    if (result.ok) {
      // marked emits <del> for GFM strikethrough
      expect(result.html).toMatch(/<del>|<s>/);
    }
  });
});

// ---------------------------------------------------------------------------
// Empty input (Requirement 2.2)
// ---------------------------------------------------------------------------
describe("parseMarkdown — empty input (Req 2.2)", () => {
  it("returns ok with empty/whitespace HTML for an empty string", () => {
    const result = parseMarkdown("");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.html.trim()).toBe("");
  });
});

// ---------------------------------------------------------------------------
// Invalid input (Requirement 2.3)
// ---------------------------------------------------------------------------
describe("parseMarkdown — invalid input (Req 2.3)", () => {
  it("rejects null input with kind 'null_input'", () => {
    const result = parseMarkdown(null);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("null_input");
  });

  it("rejects undefined input", () => {
    const result = parseMarkdown(undefined);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("null_input");
  });

  it("rejects Buffer (binary) input with kind 'binary_input'", () => {
    const result = parseMarkdown(Buffer.from([0x00, 0x01, 0x02]));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("binary_input");
  });

  it("rejects Uint8Array (binary) input with kind 'binary_input'", () => {
    const result = parseMarkdown(new Uint8Array([0x00, 0x01, 0x02]));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("binary_input");
  });

  it("rejects a non-string (number) input", () => {
    const result = parseMarkdown(42);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// wrapHtml — full document assembly
// ---------------------------------------------------------------------------
describe("wrapHtml", () => {
  const doc = wrapHtml("<p>hi</p>", "Title");

  it("produces a full HTML document with a DOCTYPE", () => {
    expect(doc).toContain("<!DOCTYPE html>");
  });

  it("includes the supplied title", () => {
    expect(doc).toContain("<title>Title</title>");
  });

  it("includes the supplied body fragment", () => {
    expect(doc).toContain("<p>hi</p>");
  });

  it("links the stylesheet at /style.css", () => {
    expect(doc).toContain('href="/style.css"');
  });

  it("embeds an EventSource live-reload script pointing at /events", () => {
    expect(doc).toContain("EventSource");
    expect(doc).toContain("/events");
    expect(doc).toContain("reload");
  });
});
