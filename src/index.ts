import { loadConfigFile, parseConfig, generateStartupMessage } from "./config.js";
import { startHttpServer } from "./server.js";

/**
 * Entry point for the md-to-html-server.
 *
 * Loads the configuration file (if present), resolves and validates it, and
 * starts the HTTP server. Any fatal configuration problem results in an error
 * message on the console and a non-zero process exit.
 *
 * Requirements 5.1–5.11.
 */
export async function main(): Promise<void> {
  const cwd = process.cwd();

  // Load the config file. A malformed JSON/YAML file causes loadConfigFile to
  // throw — treat that as a fatal error (Requirement 5.7).
  let loaded: { raw: unknown; filePath: string } | null;
  try {
    loaded = await loadConfigFile(cwd);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    console.error(`Failed to parse configuration file: ${message}`);
    process.exit(1);
  }

  // Validate and resolve the config (Requirements 5.2–5.6, 5.8, 5.9).
  const result = parseConfig(loaded?.raw ?? {}, cwd, loaded?.filePath);
  if (!result.ok) {
    console.error(result.error.message);
    process.exit(1);
  }

  const config = result.value;

  // Print the startup banner (Requirement 5.11) and start listening.
  // Port-in-use failures (Requirement 5.10) are handled inside startHttpServer.
  console.log(generateStartupMessage(config));
  startHttpServer(config);
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
