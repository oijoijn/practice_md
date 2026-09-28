import { describe, it, expect, vi } from "vitest";
import fc from "fast-check";
import type { ServerResponse } from "node:http";
import { SseManager } from "../../src/sse.js";
import type { SseClient } from "../../src/types.js";

/**
 * Build a fake SSE client whose `response` is a minimal stand-in for a
 * node:http ServerResponse — only the members SseManager touches
 * (`write` and `writableEnded`) are provided.
 */
function makeClient(id: string, writableEnded: boolean): SseClient {
  const response = {
    write: vi.fn(),
    writableEnded,
  } as unknown as ServerResponse;
  return { id, response };
}

describe("SseManager broadcast — property based tests", () => {
  // Feature: md-to-html-server, Property 8: 切断クライアントへの通知スキップ
  // Validates: Requirements 4.5
  //
  // For any set of n clients (n >= 2) where one client is disconnected via
  // removeClient(id), broadcast sends the event to exactly the remaining
  // n-1 connected clients and NOT to the removed one.
  it("mode (a) removeClient: skips the removed client, notifies the rest", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 20 }),
        fc.string(),
        // 0..1 fraction used to pick the disconnected index deterministically
        fc.double({ min: 0, max: 1, noNaN: true, noDefaultInfinity: true }),
        (n, event, frac) => {
          const disconnectIndex = Math.min(n - 1, Math.floor(frac * n));

          const manager = new SseManager();
          const clients = Array.from({ length: n }, (_, i) =>
            makeClient(`client-${i}`, false)
          );
          for (const c of clients) manager.addClient(c);

          const removed = clients[disconnectIndex];
          manager.removeClient(removed.id);

          manager.broadcast(event);

          const expectedPayload = `data: ${event}\n\n`;

          for (let i = 0; i < n; i++) {
            const write = clients[i].response.write as ReturnType<typeof vi.fn>;
            if (i === disconnectIndex) {
              expect(write).not.toHaveBeenCalled();
            } else {
              expect(write).toHaveBeenCalledTimes(1);
              expect(write).toHaveBeenCalledWith(expectedPayload);
            }
          }

          // The remaining n-1 clients are still tracked.
          expect(manager.getClientCount()).toBe(n - 1);
        }
      ),
      { numRuns: 100 }
    );
  });

  // Feature: md-to-html-server, Property 8: 切断クライアントへの通知スキップ
  // Validates: Requirements 4.5
  //
  // For any set of n clients (n >= 2) where one client's connection has
  // ended (writableEnded === true), broadcast writes only to the remaining
  // connected clients, skips the ended one, and prunes it from the set.
  it("mode (b) writableEnded: skips the ended client, notifies and prunes", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 20 }),
        fc.string(),
        fc.double({ min: 0, max: 1, noNaN: true, noDefaultInfinity: true }),
        (n, event, frac) => {
          const disconnectIndex = Math.min(n - 1, Math.floor(frac * n));

          const manager = new SseManager();
          const clients = Array.from({ length: n }, (_, i) =>
            makeClient(`client-${i}`, i === disconnectIndex)
          );
          for (const c of clients) manager.addClient(c);

          manager.broadcast(event);

          const expectedPayload = `data: ${event}\n\n`;

          for (let i = 0; i < n; i++) {
            const write = clients[i].response.write as ReturnType<typeof vi.fn>;
            if (i === disconnectIndex) {
              expect(write).not.toHaveBeenCalled();
            } else {
              expect(write).toHaveBeenCalledTimes(1);
              expect(write).toHaveBeenCalledWith(expectedPayload);
            }
          }

          // The ended client is pruned; only the connected ones remain.
          expect(manager.getClientCount()).toBe(n - 1);
        }
      ),
      { numRuns: 100 }
    );
  });
});
