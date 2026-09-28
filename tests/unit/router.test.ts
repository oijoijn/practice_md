import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  resolveRoute,
  generateIndexPage,
  generateErrorPage,
} from "../../src/router.js";

// ---------------------------------------------------------------------------
// Temp watch-directory setup
//
// resolveRoute consults fs.existsSync for static-file classification, so the
// tests operate against a real directory populated with:
//   - doc.md          (markdown file)
//   - sub/nested.md   (markdown file in a subdirectory)
//   - image.png       (existing static file with real bytes)
// ---------------------------------------------------------------------------

let watchDir: string;

beforeAll(() => {
  watchDir = fs.mkdtempSync(path.join(os.tmpdir(), "mdserver-router-test-"));

  fs.writeFileSync(path.join(watchDir, "doc.md"), "# Doc\n", "utf-8");

  const subDir = path.join(watchDir, "sub");
  fs.mkdirSync(subDir);
  fs.writeFileSync(path.join(subDir, "nested.md"), "# Nested\n", "utf-8");

  // A real static file with some bytes.
  fs.writeFileSync(
    path.join(watchDir, "image.png"),
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  );
});

afterAll(() => {
  if (watchDir !== undefined) {
    fs.rmSync(watchDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// resolveRoute — route classification (Requirements 1.1, 1.2, 1.3, 6.3)
// ---------------------------------------------------------------------------

describe("resolveRoute — special endpoints", () => {
  it("classifies '/' as the index page", () => {
    const route = resolveRoute("/", watchDir);
    expect(route.kind).toBe("index");
  });

  it("classifies '/events' as the SSE endpoint", () => {
    const route = resolveRoute("/events", watchDir);
    expect(route.kind).toBe("sse");
  });
});

describe("resolveRoute — markdown files", () => {
  it("classifies a top-level '.md' path as markdown", () => {
    const route = resolveRoute("/doc.md", watchDir);
    expect(route.kind).toBe("markdown");
    if (route.kind === "markdown") {
      expect(route.filePath.endsWith("doc.md")).toBe(true);
    }
  });

  it("classifies a subdirectory '.md' path as markdown", () => {
    const route = resolveRoute("/sub/nested.md", watchDir);
    expect(route.kind).toBe("markdown");
    if (route.kind === "markdown") {
      expect(route.filePath.endsWith(`nested.md`)).toBe(true);
      expect(route.filePath).toContain("sub");
    }
  });
});

describe("resolveRoute — static files (Requirements 6.1, 6.3)", () => {
  it("classifies an existing non-'.md' file as static", () => {
    const route = resolveRoute("/image.png", watchDir);
    expect(route.kind).toBe("static");
    if (route.kind === "static") {
      expect(route.filePath.endsWith("image.png")).toBe(true);
    }
  });

  it("classifies a missing static file as not_found", () => {
    const route = resolveRoute("/does-not-exist.png", watchDir);
    expect(route.kind).toBe("not_found");
  });
});

// ---------------------------------------------------------------------------
// resolveRoute — path traversal guard (security)
// ---------------------------------------------------------------------------

describe("resolveRoute — path traversal is blocked", () => {
  it("blocks '/../etc/passwd'", () => {
    const route = resolveRoute("/../etc/passwd", watchDir);
    expect(route.kind).toBe("not_found");
  });

  it("blocks percent-encoded traversal '/..%2f..%2fetc' that escapes the root", () => {
    // The URL layer keeps %2f encoded; decodeURIComponent then yields
    // "/../../etc", which the resolved-path guard rejects as escaping watchDir.
    const route = resolveRoute("/..%2f..%2fetc", watchDir);
    expect(route.kind).toBe("not_found");
  });

  it("blocks percent-encoded traversal to a '.md' file outside the root", () => {
    const route = resolveRoute("/..%2f..%2fsecret.md", watchDir);
    expect(route.kind).toBe("not_found");
  });

  // Note: the WHATWG URL parser collapses leading "../" segments in a path,
  // so "/../../secret.md" normalizes to "/secret.md" — it never escapes the
  // root and is therefore a legitimate in-root markdown route.
  it("treats collapsed '/../../secret.md' as an in-root markdown route", () => {
    const route = resolveRoute("/../../secret.md", watchDir);
    expect(route.kind).toBe("markdown");
    if (route.kind === "markdown") {
      expect(route.filePath.endsWith("secret.md")).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// generateIndexPage (Requirements 1.3, 1.4)
// ---------------------------------------------------------------------------

describe("generateIndexPage", () => {
  it("renders an <a href> link for each markdown file (root-relative)", () => {
    const files = [
      path.join(watchDir, "doc.md"),
      path.join(watchDir, "sub", "nested.md"),
    ];
    const html = generateIndexPage(files, watchDir);

    expect(html).toContain("<html");
    // Each file should appear inside an href attribute.
    expect(html).toMatch(/href="[^"]*doc\.md"/);
    expect(html).toMatch(/href="[^"]*nested\.md"/);
    // Links must be root-relative (start with "/").
    expect(html).toContain('href="/doc.md"');
    expect(html).toContain('href="/sub/nested.md"');
  });

  it("returns a valid page with an empty-state message when no files exist", () => {
    const html = generateIndexPage([], watchDir);
    expect(html).toContain("<html");
    // Should surface a "no files" style notice rather than any links.
    expect(html.toLowerCase()).toContain("no markdown files");
    expect(html).not.toMatch(/href="\/[^"]*\.md"/);
  });
});

// ---------------------------------------------------------------------------
// generateErrorPage (Requirements 1.2, 1.5, 6.3)
// ---------------------------------------------------------------------------

describe("generateErrorPage", () => {
  it("includes the 404 status code and message", () => {
    const html = generateErrorPage(404, "Not Found");
    expect(html).toContain("<html");
    expect(html).toContain("404");
    expect(html).toContain("Not Found");
  });

  it("includes the 500 status code and message", () => {
    const html = generateErrorPage(500, "boom");
    expect(html).toContain("500");
    expect(html).toContain("boom");
  });
});
