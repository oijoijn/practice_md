import { describe, it, expect, vi } from "vitest";
import type { ServerResponse } from "node:http";
import { SseManager } from "../../src/sse.js";
import type { SseClient } from "../../src/types.js";

// ---------------------------------------------------------------------------
// Test helper — builds a mock SSE client with a spy-able `write` and a
// controllable `writableEnded` flag. The response is typed via `unknown`
// because we only exercise the two members SseManager touches.
// ---------------------------------------------------------------------------
interface MockResponse {
  write: ReturnType<typeof vi.fn>;
  writableEnded: boolean;
}

function makeClient(
  id: string,
  overrides: Partial<MockResponse> = {},
): { client: SseClient; response: MockResponse } {
  const response: MockResponse = {
    write: vi.fn(),
    writableEnded: false,
    ...overrides,
  };
  const client: SseClient = {
    id,
    response: response as unknown as ServerResponse,
  };
  return { client, response };
}

describe("SseManager", () => {
  describe("addClient / getClientCount (Req 4.3)", () => {
    it("increments the count when a client is added", () => {
      const manager = new SseManager();
      expect(manager.getClientCount()).toBe(0);

      manager.addClient(makeClient("a").client);
      expect(manager.getClientCount()).toBe(1);
    });

    it("tracks two distinct clients", () => {
      const manager = new SseManager();
      manager.addClient(makeClient("a").client);
      manager.addClient(makeClient("b").client);
      expect(manager.getClientCount()).toBe(2);
    });
  });

  describe("removeClient (Req 4.3)", () => {
    it("decrements the count when a known client is removed", () => {
      const manager = new SseManager();
      manager.addClient(makeClient("a").client);
      manager.addClient(makeClient("b").client);

      manager.removeClient("a");
      expect(manager.getClientCount()).toBe(1);
    });

    it("is a no-op when removing an unknown id", () => {
      const manager = new SseManager();
      manager.addClient(makeClient("a").client);

      manager.removeClient("does-not-exist");
      expect(manager.getClientCount()).toBe(1);
    });
  });

  describe("broadcast (Req 4.3, 4.5)", () => {
    it("writes an SSE-formatted data event to every connected client", () => {
      const manager = new SseManager();
      const first = makeClient("a");
      const second = makeClient("b");
      manager.addClient(first.client);
      manager.addClient(second.client);

      manager.broadcast("reload");

      expect(first.response.write).toHaveBeenCalledWith("data: reload\n\n");
      expect(second.response.write).toHaveBeenCalledWith("data: reload\n\n");
    });

    it("skips and prunes clients whose response has already ended (Req 4.5)", () => {
      const manager = new SseManager();
      const live = makeClient("live");
      const ended = makeClient("ended", { writableEnded: true });
      manager.addClient(live.client);
      manager.addClient(ended.client);

      manager.broadcast("reload");

      // The ended client is never written to and is pruned from the set.
      expect(ended.response.write).not.toHaveBeenCalled();
      expect(live.response.write).toHaveBeenCalledWith("data: reload\n\n");
      expect(manager.getClientCount()).toBe(1);
    });

    it("removes a client whose write throws and still delivers to the rest (Req 4.5)", () => {
      const manager = new SseManager();
      const failing = makeClient("failing", {
        write: vi.fn(() => {
          throw new Error("connection reset");
        }),
      });
      const healthy = makeClient("healthy");
      manager.addClient(failing.client);
      manager.addClient(healthy.client);

      manager.broadcast("reload");

      // The failing client attempted a write, then got dropped.
      expect(failing.response.write).toHaveBeenCalledWith("data: reload\n\n");
      expect(healthy.response.write).toHaveBeenCalledWith("data: reload\n\n");
      expect(manager.getClientCount()).toBe(1);
    });
  });

  describe("startHeartbeat / stopHeartbeat (Req 4.4)", () => {
    it("writes a heartbeat comment line after the interval elapses", () => {
      vi.useFakeTimers();
      try {
        const manager = new SseManager();
        const { response } = registerClient(manager, "a");

        manager.startHeartbeat();

        // Interval is randomized (60s ±5s); advance well past the upper
        // bound to guarantee at least one heartbeat fires.
        vi.advanceTimersByTime(65_000);

        expect(response.write).toHaveBeenCalledWith(": heartbeat\n\n");

        manager.stopHeartbeat();
      } finally {
        vi.useRealTimers();
      }
    });

    it("stops firing heartbeats after stopHeartbeat", () => {
      vi.useFakeTimers();
      try {
        const manager = new SseManager();
        const { response } = registerClient(manager, "a");

        manager.startHeartbeat();
        manager.stopHeartbeat();

        vi.advanceTimersByTime(120_000);

        expect(response.write).not.toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    });
  });
});

// Convenience wrapper that adds a fresh mock client and returns its response.
function registerClient(
  manager: SseManager,
  id: string,
): { response: MockResponse } {
  const { client, response } = makeClient(id);
  manager.addClient(client);
  return { response };
}
