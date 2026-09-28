import { describe, it, expect, vi } from "vitest";
import fc from "fast-check";
import { createDebouncedHandler } from "../../src/watcher.js";
import { parseMarkdown, wrapHtml } from "../../src/parser.js";
import type { HtmlCache } from "../../src/types.js";

// ---------------------------------------------------------------------------
// Property 6: デバウンス後は変換処理が 1 回だけ起動される
// ---------------------------------------------------------------------------
describe("createDebouncedHandler — property based tests", () => {
  // Feature: md-to-html-server, Property 6: デバウンス後は変換処理が 1 回だけ起動される
  // Validates: Requirements 3.5
  //
  // For any n (n >= 2) change events fired within the debounce window for the
  // SAME argument, the debounced callback fires exactly once, delayMs after
  // the last event.
  it("collapses n same-arg events into a single call after the delay", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 30 }),
        fc.integer({ min: 50, max: 500 }),
        (n, delay) => {
          vi.useFakeTimers();
          try {
            const fn = vi.fn();
            const debounced = createDebouncedHandler<string>(fn, delay);

            // Fire n events back-to-back for the same argument. No timer is
            // advanced between them, so each call resets the pending timer.
            for (let i = 0; i < n; i++) {
              debounced("same-file");
            }

            // Before the window elapses, nothing has fired yet.
            expect(fn).not.toHaveBeenCalled();

            // Advance past the debounce window.
            vi.advanceTimersByTime(delay);

            expect(fn).toHaveBeenCalledTimes(1);
            expect(fn).toHaveBeenCalledWith("same-file");
          } finally {
            vi.useRealTimers();
          }
        }
      ),
      { numRuns: 50 }
    );
  });

  // Feature: md-to-html-server, Property 6: デバウンス後は変換処理が 1 回だけ起動される
  // Validates: Requirements 3.5
  //
  // Timer resets keep firing as long as successive calls stay within the
  // window: advancing by strictly less than `delay` between each call must
  // NOT trigger the callback until the window finally elapses.
  it("keeps resetting while calls stay within the window", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 30 }),
        fc.integer({ min: 50, max: 500 }),
        (n, delay) => {
          vi.useFakeTimers();
          try {
            const fn = vi.fn();
            const debounced = createDebouncedHandler<string>(fn, delay);

            // Between each call advance by 1ms — cumulatively (n-1)ms, which is
            // strictly < delay (delay >= 50, n <= 30 => at most 29ms). The
            // timer keeps resetting, so nothing fires mid-stream.
            for (let i = 0; i < n; i++) {
              debounced("same-file");
              if (i < n - 1) {
                vi.advanceTimersByTime(1);
              }
            }

            expect(fn).not.toHaveBeenCalled();

            vi.advanceTimersByTime(delay);

            expect(fn).toHaveBeenCalledTimes(1);
            expect(fn).toHaveBeenCalledWith("same-file");
          } finally {
            vi.useRealTimers();
          }
        }
      ),
      { numRuns: 50 }
    );
  });

  // Feature: md-to-html-server, Property 6: デバウンス後は変換処理が 1 回だけ起動される
  // Validates: Requirements 3.5
  //
  // Debouncing is per-argument: two distinct arguments each collapse to their
  // own single call. After the window elapses fn is called twice — once per
  // distinct argument.
  it("debounces per argument value (distinct args fire independently)", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 30 }),
        fc.integer({ min: 50, max: 500 }),
        (n, delay) => {
          vi.useFakeTimers();
          try {
            const fn = vi.fn();
            const debounced = createDebouncedHandler<string>(fn, delay);

            // Interleave n calls each for "a" and "b".
            for (let i = 0; i < n; i++) {
              debounced("a");
              debounced("b");
            }

            expect(fn).not.toHaveBeenCalled();

            vi.advanceTimersByTime(delay);

            expect(fn).toHaveBeenCalledTimes(2);
            const calledArgs = fn.mock.calls.map((c) => c[0]).sort();
            expect(calledArgs).toEqual(["a", "b"]);
          } finally {
            vi.useRealTimers();
          }
        }
      ),
      { numRuns: 50 }
    );
  });
});

// ---------------------------------------------------------------------------
// Property 7: エラー時のキャッシュ不変性
// ---------------------------------------------------------------------------

/**
 * Local reproduction of the "update on success only" rebuild logic from
 * server.ts: a conversion failure must leave the cache untouched, while a
 * successful conversion updates the entry for `filePath`.
 */
function rebuild(cache: HtmlCache, filePath: string, input: unknown): void {
  const parsed = parseMarkdown(input);
  if (!parsed.ok) {
    // Conversion error: leave the cache unchanged (Requirement 3.6).
    return;
  }
  cache.set(filePath, wrapHtml(parsed.html, filePath));
}

describe("cache invariance on conversion error — property based tests", () => {
  // Feature: md-to-html-server, Property 7: エラー時のキャッシュ不変性
  // Validates: Requirements 3.6
  //
  // For any pre-populated cache, when a conversion fails (null / binary input
  // makes parseMarkdown return { ok: false }), the cache remains byte-for-byte
  // identical to its pre-conversion state: no entry is added, changed, or
  // removed.
  it("leaves the cache identical when conversion fails", () => {
    fc.assert(
      fc.property(
        // Arbitrary initial cache: array of [key, value] tuples → Map.
        fc.array(fc.tuple(fc.string(), fc.string())),
        // The file path whose rebuild is attempted (may or may not exist).
        fc.string(),
        // A failing input: parseMarkdown rejects null and Uint8Array.
        fc.oneof(
          fc.constant(null),
          fc.constant(undefined),
          fc.uint8Array().map((a) => a)
        ),
        (entries, filePath, failingInput) => {
          const cache: HtmlCache = new Map(entries);
          const before = [...cache.entries()];

          // Sanity: the chosen input truly makes conversion fail.
          expect(parseMarkdown(failingInput).ok).toBe(false);

          rebuild(cache, filePath, failingInput);

          const after = [...cache.entries()];
          expect(after).toEqual(before);
          expect(cache.size).toBe(before.length);
        }
      ),
      { numRuns: 100 }
    );
  });

  // Feature: md-to-html-server, Property 7: エラー時のキャッシュ不変性
  // Validates: Requirements 3.6
  //
  // Complement / control: a SUCCESSFUL conversion is the only thing that
  // mutates the cache — it sets exactly the target entry and leaves all other
  // entries untouched. This pins down that the invariance above is specific to
  // the error path.
  it("only a successful conversion mutates the target entry", () => {
    fc.assert(
      fc.property(
        fc.array(fc.tuple(fc.string(), fc.string())),
        fc.string(),
        fc.string(),
        (entries, filePath, markdown) => {
          const cache: HtmlCache = new Map(entries);
          const parsed = parseMarkdown(markdown);
          // parseMarkdown on a string should succeed; skip the rare failure.
          if (!parsed.ok) return;

          const otherBefore = [...cache.entries()].filter(
            ([k]) => k !== filePath
          );

          rebuild(cache, filePath, markdown);

          // Target entry now holds the wrapped HTML.
          expect(cache.get(filePath)).toBe(wrapHtml(parsed.html, filePath));

          // Every other entry is unchanged.
          const otherAfter = [...cache.entries()].filter(
            ([k]) => k !== filePath
          );
          expect(otherAfter).toEqual(otherBefore);
        }
      ),
      { numRuns: 100 }
    );
  });
});
