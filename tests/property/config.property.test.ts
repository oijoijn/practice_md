import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { parseConfig } from "../../src/config.js";

const DEFAULT_PORT = 3000;

describe("config parseConfig — property based tests", () => {
  // Feature: md-to-html-server, Property 9: 設定のデフォルト値フォールバック
  // Validates: Requirements 5.2, 5.5, 5.6
  //
  // For any config object omitting watchDirectory and/or port, parseConfig
  // returns a ServerConfig using defaults (port: 3000, watchDirectory: cwd)
  // for the omitted fields.
  it("falls back to default values for omitted fields", () => {
    const cwd = process.cwd();

    fc.assert(
      fc.property(
        fc.record(
          {
            // watchDirectory must resolve to an existing directory for success.
            // "." resolves to cwd, so it always exists.
            watchDirectory: fc.constant("."),
            port: fc.integer({ min: 1, max: 65535 }),
          },
          { requiredKeys: [] }
        ),
        (raw) => {
          const result = parseConfig(raw, cwd);

          expect(result.ok).toBe(true);
          if (!result.ok) return;

          // port: present → same value; omitted → default 3000
          if (raw.port === undefined) {
            expect(result.value.port).toBe(DEFAULT_PORT);
          } else {
            expect(result.value.port).toBe(raw.port);
          }

          // watchDirectory: present ("." → cwd) or omitted → both resolve to cwd
          expect(result.value.watchDirectory).toBe(cwd);
        }
      ),
      { numRuns: 100 }
    );
  });

  // Feature: md-to-html-server, Property 10: 不正な設定値はエラーを返す
  // Validates: Requirements 5.7, 5.8, 5.9
  //
  // For any out-of-range port (< 1 or > 65535, or non-integer), parseConfig
  // always returns { ok: false }.
  it("returns an error for out-of-range or non-integer ports", () => {
    const cwd = process.cwd();

    const invalidPortArb = fc.oneof(
      // integers below the valid range
      fc.integer({ min: -1_000_000, max: 0 }),
      // integers above the valid range
      fc.integer({ min: 65536, max: 1_000_000 }),
      // non-integer floats (filter out any that happen to be integers)
      fc
        .double({ noNaN: true, noDefaultInfinity: true })
        .filter((n) => !Number.isInteger(n))
    );

    fc.assert(
      fc.property(invalidPortArb, (port) => {
        const result = parseConfig({ port }, cwd);
        expect(result.ok).toBe(false);
      }),
      { numRuns: 100 }
    );
  });
});
