import { describe, it, expect, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  parseConfig,
  loadConfigFile,
  generateStartupMessage,
} from "../../src/config.js";

// ---------------------------------------------------------------------------
// Helpers for temp directory / file setup used by loadConfigFile tests
// ---------------------------------------------------------------------------

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mdserver-config-test-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir !== undefined) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

// ---------------------------------------------------------------------------
// parseConfig — port validation (Requirements 5.8)
// ---------------------------------------------------------------------------

describe("parseConfig — port boundary values", () => {
  const cwd = process.cwd();

  it("accepts port=1 (lower boundary)", () => {
    const result = parseConfig({ port: 1 }, cwd);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.port).toBe(1);
    }
  });

  it("accepts port=65535 (upper boundary)", () => {
    const result = parseConfig({ port: 65535 }, cwd);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.port).toBe(65535);
    }
  });

  it("rejects port=65536 (above range)", () => {
    const result = parseConfig({ port: 65536 }, cwd);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("invalid_port");
    }
  });

  it("rejects port=0 (below range)", () => {
    const result = parseConfig({ port: 0 }, cwd);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("invalid_port");
    }
  });
});

describe("parseConfig — non-integer / wrong-type port", () => {
  const cwd = process.cwd();

  it("rejects a non-integer port (3000.5)", () => {
    const result = parseConfig({ port: 3000.5 }, cwd);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("invalid_port");
    }
  });

  it("rejects a string port", () => {
    const result = parseConfig({ port: "3000" }, cwd);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("invalid_port");
    }
  });
});

// ---------------------------------------------------------------------------
// parseConfig — defaults (Requirements 5.2, 5.5, 5.6)
// ---------------------------------------------------------------------------

describe("parseConfig — defaults", () => {
  const cwd = process.cwd();

  it("returns defaults (port 3000, watchDirectory=cwd) for empty config", () => {
    const result = parseConfig({}, cwd);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.port).toBe(3000);
      expect(result.value.watchDirectory).toBe(cwd);
    }
  });

  it("defaults port to 3000 when omitted", () => {
    const result = parseConfig({ watchDirectory: cwd }, cwd);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.port).toBe(3000);
    }
  });

  it("defaults watchDirectory to cwd when omitted", () => {
    const result = parseConfig({ port: 8080 }, cwd);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.watchDirectory).toBe(cwd);
      expect(result.value.port).toBe(8080);
    }
  });

  it("treats null raw as empty config (all defaults)", () => {
    const result = parseConfig(null, cwd);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.port).toBe(3000);
      expect(result.value.watchDirectory).toBe(cwd);
    }
  });
});

// ---------------------------------------------------------------------------
// parseConfig — watchDirectory validation (Requirements 5.9)
// ---------------------------------------------------------------------------

describe("parseConfig — watchDirectory validation", () => {
  const cwd = process.cwd();

  it("rejects a non-existent watchDirectory path", () => {
    const result = parseConfig(
      { watchDirectory: "/nonexistent/xyz123" },
      cwd
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("invalid_watch_directory");
    }
  });

  it("rejects a watchDirectory that is a file, not a directory", () => {
    const dir = makeTempDir();
    const filePath = path.join(dir, "notadir.txt");
    fs.writeFileSync(filePath, "hello");
    const result = parseConfig({ watchDirectory: filePath }, cwd);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("invalid_watch_directory");
    }
  });

  it("resolves an existing directory to an absolute path", () => {
    const dir = makeTempDir();
    const result = parseConfig({ watchDirectory: dir }, cwd);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.watchDirectory).toBe(path.resolve(cwd, dir));
    }
  });
});

// ---------------------------------------------------------------------------
// parseConfig — invalid format (Requirements 5.7)
// ---------------------------------------------------------------------------

describe("parseConfig — invalid format", () => {
  const cwd = process.cwd();

  it("rejects an array as config", () => {
    const result = parseConfig([1, 2, 3], cwd);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("invalid_format");
    }
  });

  it("rejects a primitive (string) as config", () => {
    const result = parseConfig("not an object", cwd);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("invalid_format");
    }
  });
});

// ---------------------------------------------------------------------------
// loadConfigFile — JSON / YAML loading and absence (Requirements 5.1)
// ---------------------------------------------------------------------------

describe("loadConfigFile", () => {
  it("loads a mdserver.config.json file", async () => {
    const dir = makeTempDir();
    const filePath = path.join(dir, "mdserver.config.json");
    const raw = { port: 4321, watchDirectory: "./docs" };
    fs.writeFileSync(filePath, JSON.stringify(raw), "utf-8");

    const loaded = await loadConfigFile(dir);
    expect(loaded).not.toBeNull();
    expect(loaded?.filePath).toBe(filePath);
    expect(loaded?.raw).toEqual(raw);
  });

  it("loads a mdserver.config.yaml file", async () => {
    const dir = makeTempDir();
    const filePath = path.join(dir, "mdserver.config.yaml");
    fs.writeFileSync(filePath, "port: 5555\nwatchDirectory: ./site\n", "utf-8");

    const loaded = await loadConfigFile(dir);
    expect(loaded).not.toBeNull();
    expect(loaded?.filePath).toBe(filePath);
    expect(loaded?.raw).toEqual({ port: 5555, watchDirectory: "./site" });
  });

  it("prefers JSON over YAML when both exist", async () => {
    const dir = makeTempDir();
    fs.writeFileSync(
      path.join(dir, "mdserver.config.json"),
      JSON.stringify({ port: 1111 }),
      "utf-8"
    );
    fs.writeFileSync(
      path.join(dir, "mdserver.config.yaml"),
      "port: 2222\n",
      "utf-8"
    );

    const loaded = await loadConfigFile(dir);
    expect(loaded?.filePath).toBe(path.join(dir, "mdserver.config.json"));
    expect(loaded?.raw).toEqual({ port: 1111 });
  });

  it("returns null when no config file is present", async () => {
    const dir = makeTempDir();
    const loaded = await loadConfigFile(dir);
    expect(loaded).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// generateStartupMessage (Requirements 5.11)
// ---------------------------------------------------------------------------

describe("generateStartupMessage", () => {
  it("includes the config file path, watch directory, and access URL", () => {
    const message = generateStartupMessage({
      watchDirectory: "/tmp/watch",
      port: 3000,
      configFilePath: "/tmp/mdserver.config.json",
    });
    expect(message).toContain("/tmp/mdserver.config.json");
    expect(message).toContain("/tmp/watch");
    expect(message).toContain("http://localhost:3000");
  });

  it("indicates when no config file was used", () => {
    const message = generateStartupMessage({
      watchDirectory: "/tmp/watch",
      port: 8080,
    });
    expect(message).toContain("none");
    expect(message).toContain("http://localhost:8080");
  });
});
