import { describe, it, expect } from "vitest";
import fc from "fast-check";
import * as path from "node:path";
import { parseMarkdown } from "../../src/parser.js";
import { generateIndexPage } from "../../src/router.js";

// ---------------------------------------------------------------------------
// このファイルは、requirements.md 本文に明記されているが design.md の
// Property 1〜12 ではカバーされていない、Property-Based Testing に適した
// 要件を Property 化したものです。連番は design.md に続けて 13〜15 とします。
// 仕様に無い要件は追加していません。
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Property 13: 空 Markdown は空ボディの有効な HTML を返す
// ---------------------------------------------------------------------------
// Feature: md-to-html-server, Property 13: 空 Markdown は空ボディの有効な HTML
// Validates: Requirements 2.2
//
// *For any* 空の Markdown ファイル（内容を持たない＝スペースと改行のみ）に
// 対して、parseMarkdown は成功 (ok: true) を返し、その HTML ボディは空である。
//
// 生成器の絞り込みについて: 要件 2.2 は「空の Markdown ファイル」を対象とする。
// タブ文字は GFM ではインデントされたコードブロック（<pre><code>）のトリガーに
// なり得るため、「内容を持たない空ファイル」の範囲を外れる。したがって空白の
// うちスペースと改行（および復帰）のみを生成対象とし、タブは除外する。これは
// 仕様（空ファイル）に忠実な絞り込みであり、要件の追加ではない。
describe("Property 13: 空 Markdown は空ボディの有効な HTML を返す", () => {
  // 空文字列、またはスペース・改行・復帰のみからなる文字列（タブは除外）。
  const emptyMarkdown = fc
    .array(fc.constantFrom(" ", "\n", "\r"), { minLength: 0, maxLength: 30 })
    .map((chars) => chars.join(""));

  it("空の入力は ok かつ空ボディの HTML を返す", () => {
    fc.assert(
      fc.property(emptyMarkdown, (md) => {
        const result = parseMarkdown(md);
        expect(result.ok).toBe(true);
        if (result.ok) {
          // 空の Markdown は要素を生成しないため、HTML ボディは空（空白のみ）。
          expect(result.html.trim()).toBe("");
        }
        return true;
      }),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 14: 無効な入力は種別付きエラーを返す
// ---------------------------------------------------------------------------
// Feature: md-to-html-server, Property 14: 無効な入力は種別付きエラーを返す
// Validates: Requirements 2.3
//
// *For any* 無効な入力（null / undefined / バイナリデータ）に対して、
// parseMarkdown は ok: false を返し、error.kind が入力種別を示す
// （null は "null_input"、バイナリは "binary_input"）。error.message は非空。
describe("Property 14: 無効な入力は種別付きエラーを返す", () => {
  it("バイナリデータ（任意のバイト列）は binary_input エラーを返す", () => {
    fc.assert(
      fc.property(
        fc.uint8Array({ minLength: 0, maxLength: 256 }),
        (bytes) => {
          const result = parseMarkdown(bytes);
          expect(result.ok).toBe(false);
          if (!result.ok) {
            expect(result.error.kind).toBe("binary_input");
            expect(result.error.message.length).toBeGreaterThan(0);
          }
          return true;
        },
      ),
      { numRuns: 100 },
    );
  });

  it("Buffer（任意のバイト列）も binary_input エラーを返す", () => {
    fc.assert(
      fc.property(
        fc.uint8Array({ minLength: 0, maxLength: 256 }),
        (bytes) => {
          const result = parseMarkdown(Buffer.from(bytes));
          expect(result.ok).toBe(false);
          if (!result.ok) {
            expect(result.error.kind).toBe("binary_input");
          }
          return true;
        },
      ),
      { numRuns: 100 },
    );
  });

  it("null / undefined は null_input エラーを返す", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(null, undefined),
        (nullish) => {
          const result = parseMarkdown(nullish);
          expect(result.ok).toBe(false);
          if (!result.ok) {
            expect(result.error.kind).toBe("null_input");
            expect(result.error.message.length).toBeGreaterThan(0);
          }
          return true;
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 15: 空ディレクトリのインデックスは「ファイルなし」メッセージを返す
// ---------------------------------------------------------------------------
// Feature: md-to-html-server, Property 15: 空インデックスはファイルなしメッセージ
// Validates: Requirements 1.4
//
// *For any* Watch_Directory のパスに対して、Markdown ファイルが 0 件のとき
// generateIndexPage は有効な HTML を返し、その中にファイルが存在しない旨の
// メッセージを含み、かつ Markdown ファイルへのリンク（/*.md）を一切含まない。
describe("Property 15: 空ディレクトリのインデックスはファイルなしメッセージを返す", () => {
  // 任意の（安全な文字からなる）watch ディレクトリ絶対パスを生成。
  const watchDirArb = fc
    .array(
      fc.string({ minLength: 1, maxLength: 12 }).map((s) => s.replace(/[^A-Za-z0-9_-]/g, "")),
      { minLength: 1, maxLength: 4 },
    )
    .map((segments) => segments.filter((s) => s.length > 0))
    .filter((segments) => segments.length > 0)
    .map((segments) => path.join("/", ...segments));

  it("ファイル 0 件のとき、リンクを含まずファイルなしメッセージを含む有効な HTML を返す", () => {
    fc.assert(
      fc.property(watchDirArb, (watchDirectory) => {
        const html = generateIndexPage([], watchDirectory);

        // 有効な HTML ドキュメントである。
        expect(html).toContain("<html");
        // ファイルが存在しない旨のメッセージを含む。
        expect(html.toLowerCase()).toContain("no markdown files");
        // Markdown ファイルへのリンク（href="/....md"）を一切含まない。
        expect(html).not.toMatch(/href="\/[^"]*\.md"/);
        return true;
      }),
      { numRuns: 100 },
    );
  });
});
