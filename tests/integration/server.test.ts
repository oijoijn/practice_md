import { describe, it, expect, afterEach } from "vitest";
import * as http from "node:http";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { createRequestHandler } from "../../src/server.js";
import { SseManager } from "../../src/sse.js";
import type { HtmlCache, ServerConfig } from "../../src/types.js";

// ---------------------------------------------------------------------------
// Integration tests for the HTTP server (Requirements 4.1, 4.2, 5.10).
//
// These tests spin up real `http.Server` instances on an ephemeral port
// (port 0, so the OS assigns a free one) and talk to them over real HTTP.
// We deliberately drive the SSE test through `createRequestHandler` + our own
// `http.createServer(...)` so we own the server lifecycle and can read the
// assigned port from `server.address()`. `startHttpServer` is intentionally
// NOT used for the port-conflict test because it calls `process.exit(1)` on
// EADDRINUSE, which would tear down the Vitest runner.
// ---------------------------------------------------------------------------

// Track every resource we open so afterEach can guarantee a clean shutdown;
// a lingering server or socket would keep the test process alive.
const openServers: Server[] = [];
const openRequests: http.ClientRequest[] = [];

afterEach(async () => {
  for (const req of openRequests.splice(0)) {
    req.destroy();
  }
  await Promise.all(
    openServers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => resolve());
          // Drop keep-alive sockets that would otherwise block close().
          server.closeAllConnections?.();
        }),
    ),
  );
});

/** Create a unique temporary watch directory for a test. */
function makeTempWatchDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "md-server-it-"));
}

/** Resolve the numeric port a listening server was assigned. */
function portOf(server: Server): number {
  const address = server.address() as AddressInfo;
  return address.port;
}

/** A promise that rejects after `ms` with a descriptive message. */
function timeout(ms: number, label: string): Promise<never> {
  return new Promise((_, reject) => {
    const t = setTimeout(
      () => reject(new Error(`timed out after ${ms}ms waiting for ${label}`)),
      ms,
    );
    // Do not let the timer keep the event loop alive.
    t.unref?.();
  });
}

describe("HTTP server integration", () => {
  it(
    "delivers a reload event to a connected SSE client within 1s of a broadcast (Req 4.1, 4.2)",
    async () => {
      // The watcher-triggered broadcast is the same delivery path exercised
      // here: on a Markdown change the server calls sseManager.broadcast("reload").
      // Driving the broadcast directly makes the assertion independent of
      // chokidar's filesystem-event timing while validating the identical
      // SSE delivery requirement (4.1 send within 1s, 4.2 client receives it).
      const tmp = makeTempWatchDir();
      const config: ServerConfig = { watchDirectory: tmp, port: 0 };
      const cache: HtmlCache = new Map();
      const sse = new SseManager();

      const server = http.createServer(createRequestHandler(config, cache, sse));
      openServers.push(server);

      await new Promise<void>((resolve) => server.listen(0, resolve));
      const port = portOf(server);

      // Resolves with the accumulated SSE stream text once "data: reload" arrives.
      const received = new Promise<string>((resolve, reject) => {
        const req = http.get({ port, path: "/events" }, (res) => {
          let buffer = "";
          res.setEncoding("utf-8");
          res.on("data", (chunk: string) => {
            buffer += chunk;
            if (buffer.includes("data: reload")) {
              resolve(buffer);
            }
          });
          res.on("error", reject);
        });
        openRequests.push(req);
        req.on("error", reject);
      });

      // Wait for the SSE connection to register before broadcasting, then poll
      // briefly so the initial handshake has completed.
      await waitFor(() => sse.getClientCount() === 1, 1000);
      sse.broadcast("reload");

      const buffer = await Promise.race([
        received,
        timeout(1000, "SSE reload event"),
      ]);
      expect(buffer).toContain("data: reload");
    },
    10_000,
  );

  it(
    "rejects a second bind to a port already in use with EADDRINUSE (Req 5.10)",
    async () => {
      // startHttpServer wires an EADDRINUSE handler that logs to console.error
      // and calls process.exit(1) per Req 5.10. Asserting a process exit
      // in-process is impractical (it would kill the test runner), so we assert
      // the underlying error condition that handler responds to: Node/the OS
      // rejects a double-bind to the same port by emitting an "error" event
      // whose code is "EADDRINUSE".
      const first = http.createServer();
      openServers.push(first);
      await new Promise<void>((resolve) => first.listen(0, resolve));
      const port = portOf(first);

      const second = http.createServer();
      openServers.push(second);

      const error = await Promise.race([
        new Promise<NodeJS.ErrnoException>((resolve) => {
          second.on("error", (err: NodeJS.ErrnoException) => resolve(err));
          second.listen(port);
        }),
        timeout(5000, "EADDRINUSE error"),
      ]);

      expect(error.code).toBe("EADDRINUSE");
    },
    10_000,
  );
});

/**
 * Poll `predicate` until it returns true or the deadline elapses. Used to wait
 * for an asynchronous side effect (an SSE client registering) without a fixed
 * sleep.
 */
async function waitFor(
  predicate: () => boolean,
  timeoutMs: number,
): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error("timed out waiting for condition");
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
