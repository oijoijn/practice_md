import * as fs from "node:fs";
import * as path from "node:path";
import { load as loadYaml } from "js-yaml";
import type { RawConfig, Result, ServerConfig } from "./types.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PORT_MIN = 1;
const PORT_MAX = 65535;
const DEFAULT_PORT = 3000;

const CONFIG_FILE_NAMES = [
  "mdserver.config.json",
  "mdserver.config.yaml",
] as const;

// ---------------------------------------------------------------------------
// ConfigError type
// ---------------------------------------------------------------------------

export interface ConfigError {
  kind:
    | "invalid_port"
    | "invalid_watch_directory"
    | "invalid_format"
    | "unknown";
  message: string;
}

// ---------------------------------------------------------------------------
// parseConfig
// ---------------------------------------------------------------------------

/**
 * Validate and resolve a raw config object into a fully typed ServerConfig.
 *
 * This is a pure function: it performs no I/O and is fully unit-testable.
 * The `cwd` parameter is used to:
 *   - supply the default watchDirectory when none is specified
 *   - resolve a relative watchDirectory to an absolute path
 *
 * Returns a Result so callers never need to catch exceptions.
 */
export function parseConfig(
  raw: unknown,
  cwd: string,
  configFilePath?: string
): Result<ServerConfig, ConfigError> {
  // If raw is null/undefined treat it as an empty object (use all defaults)
  const obj = raw == null ? {} : raw;

  if (typeof obj !== "object" || Array.isArray(obj)) {
    return {
      ok: false,
      error: {
        kind: "invalid_format",
        message: "Configuration must be a JSON object.",
      },
    };
  }

  const rawObj = obj as Record<string, unknown>;

  // -------------------------------------------------------------------------
  // port
  // -------------------------------------------------------------------------
  let port: number;

  if (rawObj.port === undefined || rawObj.port === null) {
    port = DEFAULT_PORT;
  } else {
    const rawPort = rawObj.port;
    // Must be an integer-valued number
    if (
      typeof rawPort !== "number" ||
      !Number.isInteger(rawPort) ||
      rawPort < PORT_MIN ||
      rawPort > PORT_MAX
    ) {
      return {
        ok: false,
        error: {
          kind: "invalid_port",
          message: `port must be an integer between ${PORT_MIN} and ${PORT_MAX}, but received: ${JSON.stringify(rawPort)}.`,
        },
      };
    }
    port = rawPort;
  }

  // -------------------------------------------------------------------------
  // watchDirectory
  // -------------------------------------------------------------------------
  let watchDirectory: string;

  if (
    rawObj.watchDirectory === undefined ||
    rawObj.watchDirectory === null
  ) {
    watchDirectory = cwd;
  } else {
    if (typeof rawObj.watchDirectory !== "string") {
      return {
        ok: false,
        error: {
          kind: "invalid_watch_directory",
          message: `watchDirectory must be a string, but received: ${typeof rawObj.watchDirectory}.`,
        },
      };
    }

    // Resolve relative paths against cwd
    const resolved = path.resolve(cwd, rawObj.watchDirectory);

    // Verify the path exists and is a directory
    let stat: fs.Stats;
    try {
      stat = fs.statSync(resolved);
    } catch {
      return {
        ok: false,
        error: {
          kind: "invalid_watch_directory",
          message: `watchDirectory does not exist: "${resolved}".`,
        },
      };
    }

    if (!stat.isDirectory()) {
      return {
        ok: false,
        error: {
          kind: "invalid_watch_directory",
          message: `watchDirectory is not a directory: "${resolved}".`,
        },
      };
    }

    watchDirectory = resolved;
  }

  const config: ServerConfig = { watchDirectory, port };
  if (configFilePath !== undefined) {
    config.configFilePath = configFilePath;
  }

  return { ok: true, value: config };
}

// ---------------------------------------------------------------------------
// loadConfigFile
// ---------------------------------------------------------------------------

/**
 * Look for a config file in `cwd`, trying JSON first then YAML.
 *
 * Returns the parsed object on success, or `null` if no file is found.
 * Throws (or rejects) if a file is found but cannot be parsed — the caller
 * is responsible for handling that case (usually: print error and exit).
 */
export async function loadConfigFile(
  cwd: string
): Promise<{ raw: RawConfig; filePath: string } | null> {
  for (const fileName of CONFIG_FILE_NAMES) {
    const filePath = path.resolve(cwd, fileName);

    if (!fs.existsSync(filePath)) {
      continue;
    }

    const content = await fs.promises.readFile(filePath, "utf-8");

    if (fileName.endsWith(".json")) {
      // JSON parsing — let syntax errors propagate to caller
      const parsed: unknown = JSON.parse(content);
      return { raw: parsed as RawConfig, filePath };
    } else {
      // YAML parsing — let parse errors propagate to caller
      const parsed: unknown = loadYaml(content);
      return { raw: (parsed ?? {}) as RawConfig, filePath };
    }
  }

  // No config file found
  return null;
}

// ---------------------------------------------------------------------------
// generateStartupMessage
// ---------------------------------------------------------------------------

/**
 * Build the console message printed when the server starts successfully.
 *
 * Requirements 5.11: Print the config file path (if any), the absolute
 * watchDirectory path, and the access URL.
 */
export function generateStartupMessage(config: ServerConfig): string {
  const lines: string[] = [];

  lines.push("md-to-html-server started");
  lines.push("");

  if (config.configFilePath !== undefined) {
    lines.push(`  Config file   : ${config.configFilePath}`);
  } else {
    lines.push("  Config file   : (none — using defaults)");
  }

  lines.push(`  Watch dir     : ${config.watchDirectory}`);
  lines.push(`  Access URL    : http://localhost:${config.port}`);

  return lines.join("\n");
}
