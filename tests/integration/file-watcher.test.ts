import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import type { FSWatcher } from "chokidar";
import { startWatcher } from "../../src/watcher.js";
import type { WatcherCallbacks } from "../../src/types.js";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** A promise + its resolve function, so a callback can complete an await. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/** Reject after `ms`, so tests fail fast instead of hanging on missed events. */
function timeout(ms: number, label: string): Promise<never> {
  return new Promise((_, reject) => {
    setTimeout(() => reject(new Error(`timeout after ${ms}ms: ${label}`)), ms);
  });
}

/** Wait for chokidar to finish its initial scan before mutating the tree. */
function waitReady(watcher: FSWatcher): Promise<void> {
  return new Promise((resolve) => watcher.on("ready", () => resolve()));
}

// A no-op set of callbacks; individual tests override the relevant handler.
function noopCallbacks(): WatcherCallbacks {
  return {
    onChange: async () => {},
    onAdd: async () => {},
    onUnlink: () => {},
  };
}

describe("File_Watcher integration (Requirements 3.1–3.4)", () => {
  let tmpDir: string;
  let watcher: FSWatcher | undefined;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "md-watcher-"));
    watcher = undefined;
  });

  afterEach(async () => {
    if (watcher) {
      await watcher.close();
      watcher = undefined;
    }
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // Requirement 3.2: a newly added .md file is detected → onAdd
  // -------------------------------------------------------------------------
  it(
    "fires onAdd when a new .md file is created",
    async () => {
      const added = deferred<string>();
      const callbacks = noopCallbacks();
      callbacks.onAdd = async (filePath: string) => {
        added.resolve(filePath);
      };

      watcher = startWatcher(tmpDir, callbacks);
      await waitReady(watcher);

      const target = join(tmpDir, "new.md");
      writeFileSync(target, "# New file\n");

      const receivedPath = await Promise.race([
        added.promise,
        timeout(3000, "onAdd for new.md"),
      ]);

      expect(receivedPath.endsWith(`${sep}new.md`)).toBe(true);
    },
    10000
  );

  // -------------------------------------------------------------------------
  // Requirement 3.1: modifying an existing .md file is detected → onChange
  // -------------------------------------------------------------------------
  it(
    "fires onChange when an existing .md file is modified",
    async () => {
      // Create the file BEFORE the watcher starts so it exists at ready time
      // and its later write is reported as a `change` (not an `add`).
      const target = join(tmpDir, "doc.md");
      writeFileSync(target, "# Original\n");

      const changed = deferred<string>();
      const callbacks = noopCallbacks();
      callbacks.onChange = async (filePath: string) => {
        changed.resolve(filePath);
      };

      watcher = startWatcher(tmpDir, callbacks);
      await waitReady(watcher);

      writeFileSync(target, "# Modified content\n");

      const receivedPath = await Promise.race([
        changed.promise,
        // event latency + 300ms debounce; generous ceiling to avoid flakiness
        timeout(5000, "onChange for doc.md"),
      ]);

      expect(receivedPath.endsWith(`${sep}doc.md`)).toBe(true);
    },
    10000
  );

  // -------------------------------------------------------------------------
  // Requirement 3.3: deleting a .md file is detected → onUnlink (no debounce)
  // -------------------------------------------------------------------------
  it(
    "fires onUnlink when a .md file is deleted",
    async () => {
      const target = join(tmpDir, "doomed.md");
      writeFileSync(target, "# Delete me\n");

      const unlinked = deferred<string>();
      const callbacks = noopCallbacks();
      callbacks.onUnlink = (filePath: string) => {
        unlinked.resolve(filePath);
      };

      watcher = startWatcher(tmpDir, callbacks);
      await waitReady(watcher);

      unlinkSync(target);

      const receivedPath = await Promise.race([
        unlinked.promise,
        timeout(3000, "onUnlink for doomed.md"),
      ]);

      expect(receivedPath.endsWith(`${sep}doomed.md`)).toBe(true);
    },
    10000
  );

  // -------------------------------------------------------------------------
  // Requirement 3.4: the conversion completes within ~1s of a file change.
  //
  // We wire a change callback that mirrors the rebuild path (read → store into
  // a cache Map) and measure the delta between the write and callback
  // completion. The 300ms debounce is part of that budget, so we allow a
  // lenient ceiling (< 1500ms) to stay reliable across environments while
  // still documenting the 1-second target of Req 3.4.
  // -------------------------------------------------------------------------
  it(
    "completes the cache update within ~1 second of a change",
    async () => {
      const target = join(tmpDir, "timed.md");
      writeFileSync(target, "# Start\n");

      const cache = new Map<string, string>();
      const done = deferred<number>();

      const callbacks = noopCallbacks();
      callbacks.onChange = async (filePath: string) => {
        // Mirror the rebuild logic: store the converted content into the cache.
        cache.set(filePath, "# Updated\n");
        done.resolve(Date.now());
      };

      watcher = startWatcher(tmpDir, callbacks);
      await waitReady(watcher);

      const writeAt = Date.now();
      writeFileSync(target, "# Updated\n");

      const callbackAt = await Promise.race([
        done.promise,
        timeout(5000, "cache update within 1s"),
      ]);

      const elapsed = callbackAt - writeAt;
      expect(cache.has(target)).toBe(true);
      // Lenient ceiling: 1000ms target + debounce/latency tolerance.
      expect(elapsed).toBeLessThan(1500);
    },
    10000
  );
});
