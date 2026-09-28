import type { SseClient } from "./types.js";

// ---------------------------------------------------------------------------
// Heartbeat timing constants (Requirement 4.4: 60s ±5s)
// ---------------------------------------------------------------------------
export const HEARTBEAT_INTERVAL_MS = 60_000;
export const HEARTBEAT_TOLERANCE_MS = 5_000;

/**
 * Manages the set of connected Server-Sent Events (SSE) clients used to
 * deliver Live_Reload notifications to browsers.
 *
 * Responsibilities:
 * - Track connected clients keyed by id (Requirement 4.3).
 * - Broadcast reload events to every live client, skipping / pruning any
 *   client whose connection has already ended or errors on write
 *   (Requirement 4.5).
 * - Keep connections alive with periodic heartbeat comment lines every
 *   60s ±5s (Requirement 4.4).
 */
export class SseManager {
  private readonly clients = new Map<string, SseClient>();
  private heartbeatTimer: NodeJS.Timeout | null = null;

  /** Register a new SSE client. */
  addClient(client: SseClient): void {
    this.clients.set(client.id, client);
  }

  /** Remove a client by id. Safe to call for unknown ids. */
  removeClient(clientId: string): void {
    this.clients.delete(clientId);
  }

  /**
   * Send an SSE `data:` event to every connected client.
   *
   * Clients whose response has already ended are skipped, and any client
   * that throws while writing is removed from the set. Delivery to the
   * remaining clients always continues.
   */
  broadcast(event: string): void {
    this.writeToAll(`data: ${event}\n\n`);
  }

  /**
   * Begin sending heartbeat comment lines (`: heartbeat\n\n`) to keep
   * connections alive. Each cycle is scheduled at a randomized interval
   * within the tolerance window (60s ±5s). Dead clients are pruned on
   * every heartbeat. Calling this while a heartbeat is already running
   * restarts the schedule.
   */
  startHeartbeat(intervalMs: number = HEARTBEAT_INTERVAL_MS): void {
    this.stopHeartbeat();

    const scheduleNext = (): void => {
      // Randomize within ±HEARTBEAT_TOLERANCE_MS around the base interval.
      const jitter =
        (Math.random() * 2 - 1) * HEARTBEAT_TOLERANCE_MS;
      const delay = Math.max(0, intervalMs + jitter);
      this.heartbeatTimer = setTimeout(() => {
        this.writeToAll(": heartbeat\n\n");
        scheduleNext();
      }, delay);
    };

    scheduleNext();
  }

  /** Stop the heartbeat timer if one is running. */
  stopHeartbeat(): void {
    if (this.heartbeatTimer !== null) {
      clearTimeout(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  /** Number of currently connected clients. */
  getClientCount(): number {
    return this.clients.size;
  }

  /**
   * Write a raw SSE payload to every client, skipping ended connections and
   * pruning clients that are ended or that throw on write.
   */
  private writeToAll(payload: string): void {
    for (const [id, client] of this.clients) {
      // Skip clients whose response stream has already finished.
      if (client.response.writableEnded) {
        this.clients.delete(id);
        continue;
      }
      try {
        client.response.write(payload);
      } catch {
        // A write failure means the connection is dead — drop the client
        // and keep serving the rest.
        this.clients.delete(id);
      }
    }
  }
}
