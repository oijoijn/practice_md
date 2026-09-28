import { watch, type FSWatcher } from "chokidar";
import type { Stats } from "node:fs";
import type { WatcherCallbacks } from "./types.js";

/** Debounce window applied to change/add events (ms). */
export const DEBOUNCE_MS = 300;

// ---------------------------------------------------------------------------
// createDebouncedHandler
// ---------------------------------------------------------------------------

/**
 * Wrap `fn` so that rapid successive calls sharing the same argument value
 * collapse into a single invocation fired `delayMs` after the last call.
 *
 * Debouncing is performed **per argument value**: a pending timer is tracked
 * in a `Map` keyed by the argument, so rapid changes to the same file collapse
 * to one call while changes to different files each fire independently. Every
 * new call for a given argument resets that argument's timer.
 *
 * @param fn      The callback to invoke after the debounce window elapses.
 * @param delayMs The debounce window in milliseconds.
 * @returns A debounced function accepting the same argument as `fn`.
 */
export function createDebouncedHandler<T>(
  fn: (arg: T) => void,
  delayMs: number
): (arg: T) => void {
  const timers = new Map<T, ReturnType<typeof setTimeout>>();

  return (arg: T): void => {
    const existing = timers.get(arg);
    if (existing !== undefined) {
      clearTimeout(existing);
    }

    const timer = setTimeout(() => {
      timers.delete(arg);
      fn(arg);
    }, delayMs);

    timers.set(arg, timer);
  };
}

// ---------------------------------------------------------------------------
// startWatcher
// ---------------------------------------------------------------------------

/** True when a path denotes a Markdown file (`.md`, case-insensitive). */
function isMarkdownFile(filePath: string): boolean {
  return filePath.toLowerCase().endsWith(".md");
}

/**
 * Start watching `directory` (including its subdirectories) and dispatch
 * file-system events to the supplied callbacks.
 *
 * Behavior:
 * - `change` / `add` on a `.md` file  → debounced (300ms) → `onChange` / `onAdd`
 * - `unlink` on a `.md` file          → `onUnlink` immediately (no debounce)
 *
 * chokidar v4 watches subdirectories recursively by default. Non-Markdown
 * files are ignored at the handler level so their events never reach the
 * callbacks.
 *
 * @param directory Absolute path to the directory to watch.
 * @param callbacks Handlers for change / add / unlink events.
 * @returns The underlying chokidar `FSWatcher` instance.
 */
export function startWatcher(
  directory: string,
  callbacks: WatcherCallbacks
): FSWatcher {
  const watcher = watch(directory, {
    ignoreInitial: true,
    persistent: true,
  });

  const debouncedChange = createDebouncedHandler<string>((filePath) => {
    void callbacks.onChange(filePath);
  }, DEBOUNCE_MS);

  const debouncedAdd = createDebouncedHandler<string>((filePath) => {
    void callbacks.onAdd(filePath);
  }, DEBOUNCE_MS);

  watcher.on("change", (filePath: string, _stats?: Stats) => {
    if (isMarkdownFile(filePath)) {
      debouncedChange(filePath);
    }
  });

  watcher.on("add", (filePath: string, _stats?: Stats) => {
    if (isMarkdownFile(filePath)) {
      debouncedAdd(filePath);
    }
  });

  watcher.on("unlink", (filePath: string) => {
    if (isMarkdownFile(filePath)) {
      callbacks.onUnlink(filePath);
    }
  });

  return watcher;
}
