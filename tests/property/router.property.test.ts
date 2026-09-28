import { describe, it, expect } from "vitest";
import fc from "fast-check";
import type { IncomingMessage, ServerResponse } from "node:http";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { generateIndexPage } from "../../src/router.js";
import { createRequestHandler } from "../../src/server.js";
import { SseManager } from "../../src/sse.js";
import type { ServerConfig, HtmlCache } from "../../src/types.js";

// ---------------------------------------------------------------------------
// Test doubles
// ---------------------------------------------------------------------------

interface CapturedResponse {
  statusCode: number | null;
  headers: Record<string, string>;
  body: string;
}

/**
 * Build a minimal fake ServerResponse that captures the status code, headers
 * and body written by the request handler. Only the subset of the
 * ServerResponse surface the handler actually uses is implemented.
 */
function makeFakeRes(): { res: ServerResponse; captured: CapturedResponse } {
  const captured: CapturedResponse = {
    statusCode: null,
    headers: {},
    body: "",
  };

  const res = {
    writableEnded: false,
    writeHead(code: number, headers?: Record<string, string>) {
      captured.statusCode = code;
      if (headers) {
        for (const [k, v] of Object.entries(headers)) {
          captured.headers[k] = String(v);
        }
      }
      return this;
    },
    setHeader(name: string, value: string) {
      captured.headers[name] = String(value);
    },
    getHeader(name: string) {
      return captured.headers[name];
    },
    write(_chunk: unknown) {
      return true;
    },
    end(chunk?: unknown) {
      if (chunk !== undefined) {
        captured.body += Buffer.isBuffer(chunk)
          ? chunk.toString("utf-8")
          : String(chunk);
      }
      (this as { writableEnded: boolean }).writableEnded = true;
      return this;
    },
    on() {
      return this;
    },
  } as unknown as ServerResponse;

  return { res, captured };
}

/** Build a minimal fake IncomingMessage carrying just a request URL. */
function makeFakeReq(url: string): IncomingMessage {
  return { url, on() {} } as unknown as IncomingMessage;
}

function makeConfig(watchDirectory: string): ServerConfig {
  return { watchDirectory, port: 0 };
}

// ---------------------------------------------------------------------------
// Property 1: Markdown レスポンスの HTTP 属性
// ---------------------------------------------------------------------------
// Feature: md-to-html-server, Property 1: Markdown レスポンスの HTTP 属性
// Validates: Requirements 1.1
//
// For any valid Markdown string written to a `.md` file in the watch
// directory, the request handler responds with HTTP 200 and a
// `Content-Type: text/html; charset=utf-8` header.
describe("Property 1: Markdown レスポンスの HTTP 属性", () => {
  it("markdown requests return 200 with text/html; charset=utf-8", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "md-router-p1-"));
    try {
      fc.assert(
        fc.property(fc.string(), (markdown) => {
          const fileName = "doc.md";
          const filePath = path.join(tmpDir, fileName);
          fs.writeFileSync(filePath, markdown, "utf-8");

          // Fresh cache each run so we exercise the read+convert path.
          const cache: HtmlCache = new Map();
          const handler = createRequestHandler(
            makeConfig(tmpDir),
            cache,
            new SseManager(),
          );

          const { res, captured } = makeFakeRes();
          handler(makeFakeReq(`/${fileName}`), res);

          expect(captured.statusCode).toBe(200);
          expect(captured.headers["Content-Type"]).toBe(
            "text/html; charset=utf-8",
          );
          return true;
        }),
        { numRuns: 50 },
      );
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Property 2: 存在しないリソースは常に 404
// ---------------------------------------------------------------------------
// Feature: md-to-html-server, Property 2: 存在しないリソースは常に 404
// Validates: Requirements 1.2, 6.3
//
// For any path that does not exist in the (empty) watch directory, the
// handler responds with HTTP 404 and error HTML — regardless of whether the
// path carries a `.md` extension or some other extension.
describe("Property 2: 存在しないリソースは常に 404", () => {
  // A single safe path segment: alphanumerics only, non-empty, so it never
  // collapses to "/", "/events" or contains path separators / traversal.
  const safeSegment = fc
    .string({ minLength: 1, maxLength: 20 })
    .map((s) => s.replace(/[^A-Za-z0-9]/g, ""))
    .filter((s) => s.length > 0 && s !== "events");

  const extension = fc.constantFrom(".md", ".png", ".xyz", ".css", ".js", ".txt");

  it("nonexistent files always return 404 regardless of extension", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "md-router-p2-"));
    try {
      fc.assert(
        fc.property(safeSegment, extension, (name, ext) => {
          const requestPath = `/${name}${ext}`;

          const cache: HtmlCache = new Map();
          const handler = createRequestHandler(
            makeConfig(tmpDir),
            cache,
            new SseManager(),
          );

          const { res, captured } = makeFakeRes();
          handler(makeFakeReq(requestPath), res);

          expect(captured.statusCode).toBe(404);
          // Body is the error HTML page and mentions the error.
          expect(captured.body).toContain("Error");
          return true;
        }),
        { numRuns: 50 },
      );
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Property 3: インデックスページに全ファイルリンクが含まれる
// ---------------------------------------------------------------------------
// Feature: md-to-html-server, Property 3: インデックスページに全ファイルリンクが含まれる
// Validates: Requirements 1.3
//
// For any list of Markdown file names, generateIndexPage returns HTML that
// contains a link (root-relative href) to every file in the list.
describe("Property 3: インデックスページに全ファイルリンクが含まれる", () => {
  // Safe relative file names: alphanumeric + hyphen/underscore segments,
  // ending in .md, no path separators / spaces / HTML-special chars so href
  // escaping stays a no-op.
  const safeName = fc
    .string({ minLength: 1, maxLength: 20 })
    .map((s) => s.replace(/[^A-Za-z0-9_-]/g, ""))
    .filter((s) => s.length > 0)
    .map((s) => `${s}.md`);

  // Distinct names keep the reasoning simple (avoids duplicate hrefs).
  const fileNames = fc.uniqueArray(safeName, { minLength: 0, maxLength: 8 });

  it("every file name appears as a root-relative link", () => {
    const watchDirectory = path.join(os.tmpdir(), "md-index-watch");

    fc.assert(
      fc.property(fileNames, (names) => {
        const absPaths = names.map((n) => path.join(watchDirectory, n));
        const html = generateIndexPage(absPaths, watchDirectory);

        for (const name of names) {
          const href = `/${name}`;
          expect(html).toContain(`href="${href}"`);
        }
        return true;
      }),
      { numRuns: 100 },
    );
  });
});
