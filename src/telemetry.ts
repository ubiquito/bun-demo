/**
 * Reactor telemetry: one unref'd heartbeat that reads the ship's real vitals —
 * memory from the unified mimalloc heap, CPU and event-loop lag over the last
 * interval — and publishes a TelemetryFrame. Nothing here is estimated.
 */
import type { TelemetryFrame } from "./types.ts";

export function startTelemetry(opts: {
  getServerCounts: () => { pendingRequests: number; pendingWebSockets: number };
  getRequestsServed: () => number;
  publish: (frame: TelemetryFrame) => void;
  intervalMs?: number;
}): () => void {
  const intervalMs = opts.intervalMs ?? 500;
  let lastTick = Bun.nanoseconds();
  let lastCpu = process.cpuUsage();

  const timer = setInterval(() => {
    const now = Bun.nanoseconds();
    const actualMs = (now - lastTick) / 1e6;
    lastTick = now;

    const cpu = process.cpuUsage();
    const busyUs = cpu.user - lastCpu.user + cpu.system - lastCpu.system;
    lastCpu = cpu;

    const mem = process.memoryUsage();
    const counts = opts.getServerCounts();

    opts.publish({
      type: "telemetry",
      t: Date.now(),
      uptime: process.uptime(),
      rss: mem.rss,
      heapUsed: mem.heapUsed,
      // timer drift: how late this tick arrived is how long the loop was held up
      loopLagMs: Math.max(0, actualMs - intervalMs),
      cpu: actualMs > 0 ? busyUs / 1000 / actualMs : 0,
      requestsServed: opts.getRequestsServed(),
      pendingRequests: counts.pendingRequests,
      pendingWebSockets: counts.pendingWebSockets,
    });
  }, intervalMs);

  // the heartbeat must never be the thing keeping the ship awake
  timer.unref();
  return () => clearInterval(timer);
}
