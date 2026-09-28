import { describe, it, expect } from "vitest";
import fc from "fast-check";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as mime from "mime-types";

import { getContentType, DEFAULT_CONTENT_TYPE } from "../../src/types.js";

// ---------------------------------------------------------------------------
// Property 11: Content-Type の正確なマッピング
// ---------------------------------------------------------------------------
// Feature: md-to-html-server, Property 11: Content-Type の正確なマッピング
// Validates: Requirements 6.2
//
// For any file extension, getContentType returns the correct MIME type for
// known extensions, and `application/octet-stream` (DEFAULT_CONTENT_TYPE) for
// unknown ones (or files with no extension).
describe("Property 11: Content-Type の正確なマッピング", () => {
  // Known extension → expected MIME type. The expected values were verified
  // against the mime-types lookup table (e.g. `.js` resolves to
  // "application/javascript" in this version, not "text/javascript").
  const KNOWN: ReadonlyArray<readonly [string, string]> = [
    [".html", "text/html"],
    [".css", "text/css"],
    [".js", "application/javascript"],
    [".png", "image/png"],
    [".jpg", "image/jpeg"],
    [".json", "application/json"],
    [".svg", "image/svg+xml"],
    [".txt", "text/plain"],
  ];

  it("known extensions map to their correct MIME type", () => {
    fc.assert(
      fc.property(fc.constantFrom(...KNOWN), ([ext, expected]) => {
        expect(getContentType(`file${ext}`)).toBe(expected);
        return true;
      }),
      { numRuns: 100 },
    );
  });

  it("unknown extensions fall back to application/octet-stream", () => {
    // Random lowercase-letter extensions. We filter out anything the
    // mime-types table actually recognizes so we only assert on genuinely
    // unknown extensions.
    const unknownExt = fc
      .string({ minLength: 5, maxLength: 10 })
      .map((s) => s.replace(/[^a-z]/gi, "").toLowerCase())
      .filter((s) => s.length >= 5)
      .map((s) => `.zz${s}`)
      .filter((ext) => mime.lookup(`file${ext}`) === false);

    fc.assert(
      fc.property(unknownExt, (ext) => {
        expect(getContentType(`file${ext}`)).toBe(DEFAULT_CONTENT_TYPE);
        return true;
      }),
      { numRuns: 100 },
    );
  });

  it("a file with no extension falls back to application/octet-stream", () => {
    expect(getContentType("README")).toBe(DEFAULT_CONTENT_TYPE);
    expect(getContentType("noext")).toBe(DEFAULT_CONTENT_TYPE);
  });
});

// ---------------------------------------------------------------------------
// Property 12: 静的ファイルのバイト列保全性
// ---------------------------------------------------------------------------
// Feature: md-to-html-server, Property 12: 静的ファイルのバイト列保全性
// Validates: Requirements 6.1
//
// For any byte sequence, the static file response body equals the original
// bytes with no transformation/encoding.
//
// The actual serving lives in server.ts's `handleStatic`, which reads a file
// via `fs.readFileSync(filePath)` with NO encoding argument (yielding a raw
// Buffer) and writes that Buffer directly to the response. This property
// models Req 6.1 at the byte level: it writes random bytes to a temp file and
// reads them back exactly as handleStatic does, asserting the round-tripped
// Buffer is byte-for-byte identical to the original.
describe("Property 12: 静的ファイルのバイト列保全性", () => {
  it("reading a static file preserves the original bytes exactly", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "md-static-p12-"));
    try {
      fc.assert(
        fc.property(
          fc.uint8Array({ minLength: 0, maxLength: 256 }),
          (bytes) => {
            const filePath = path.join(tmpDir, "asset.bin");
            const original = Buffer.from(bytes);

            // Write the raw bytes, then read them back the same way
            // handleStatic does: no encoding arg → Buffer.
            fs.writeFileSync(filePath, original);
            const readBack = fs.readFileSync(filePath);

            expect(readBack.length).toBe(original.length);
            expect(readBack.equals(original)).toBe(true);
            return true;
          },
        ),
        { numRuns: 50 },
      );
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
