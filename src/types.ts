import type { ServerResponse } from "node:http";
import * as mime from "mime-types";

// ---------------------------------------------------------------------------
// Generic Result type — used throughout the codebase for error propagation
// (no exceptions thrown across component boundaries)
// ---------------------------------------------------------------------------
export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

// ---------------------------------------------------------------------------
// Parser types (MD → HTML)
// ---------------------------------------------------------------------------
export interface ParseError {
  /** Discriminates the reason the parse failed. */
  kind: "null_input" | "binary_input" | "conversion_error";
  message: string;
}

export type ParseResult =
  | { ok: true; html: string }
  | { ok: false; error: ParseError };

// ---------------------------------------------------------------------------
// Pretty_Printer types (HTML → MD)
// ---------------------------------------------------------------------------
export type PrintResult =
  | { ok: true; markdown: string }
  | { ok: false; error: string };

// ---------------------------------------------------------------------------
// Router types
// ---------------------------------------------------------------------------
export type RouteKind =
  | { kind: "markdown"; filePath: string }
  | { kind: "static"; filePath: string }
  | { kind: "index" }
  | { kind: "sse" }
  | { kind: "not_found"; requestPath: string };

// ---------------------------------------------------------------------------
// Config types
// ---------------------------------------------------------------------------

/** The raw shape parsed from the JSON/YAML config file. All fields optional. */
export interface RawConfig {
  watchDirectory?: string;
  port?: number;
}

/** Fully resolved server configuration used at runtime. */
export interface ServerConfig {
  /** Absolute path to the directory being watched (already resolved). */
  watchDirectory: string;
  /** TCP port the server will listen on (1–65535). */
  port: number;
  /** Path to the config file that was loaded, if any. */
  configFilePath?: string;
}

// ---------------------------------------------------------------------------
// SSE types
// ---------------------------------------------------------------------------
export interface SseClient {
  id: string;
  response: ServerResponse;
}

// ---------------------------------------------------------------------------
// File_Watcher callback types
// ---------------------------------------------------------------------------
export interface WatcherCallbacks {
  onChange: (filePath: string) => Promise<void>;
  onAdd: (filePath: string) => Promise<void>;
  onUnlink: (filePath: string) => void;
}

// ---------------------------------------------------------------------------
// Cache type
// ---------------------------------------------------------------------------

/** Maps an absolute file path to the last successfully converted HTML string. */
export type HtmlCache = Map<string, string>;

// ---------------------------------------------------------------------------
// Content-Type resolution
// ---------------------------------------------------------------------------

/** Fallback MIME type for extensions the lookup table does not recognize. */
export const DEFAULT_CONTENT_TYPE = "application/octet-stream";

/**
 * Resolves the MIME type for a file based on its extension.
 *
 * Uses the `mime-types` lookup table to map a file path / extension to its
 * MIME type (e.g. `.css` → `text/css`, `.png` → `image/png`). When the
 * extension is unknown — or the input has no resolvable extension — the
 * generic `application/octet-stream` type is returned.
 *
 * Note: charset handling (e.g. `; charset=utf-8`) is applied elsewhere; this
 * function returns the bare MIME type as reported by the lookup.
 */
export function getContentType(filePath: string): string {
  const resolved = mime.lookup(filePath);
  return resolved === false ? DEFAULT_CONTENT_TYPE : resolved;
}
