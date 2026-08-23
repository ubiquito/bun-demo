import { describe, expect, test } from "bun:test";
import { burst, reactorStatus, startupRace } from "../src/systems/reactor.ts";

describe("reactor", () => {
  test("deck reports online with the running Bun aboard", () => {
    const status = reactorStatus();
    expect(status.online).toBeTrue();
    expect(status.note).toContain(Bun.version);
  });

  test("startup race: the bun lane runs and posts a real time", async () => {
    const race = await startupRace();
    expect(race.runs).toBeGreaterThan(0);

    const bunLane = race.lanes.find(l => l.runtime.startsWith("bun"))!;
    expect(bunLane.available).toBeTrue();
    expect(bunLane.bestMs).toBeGreaterThan(0);
    expect(bunLane.medianMs).toBeGreaterThanOrEqual(bunLane.bestMs);
    expect(race.note.length).toBeGreaterThan(0);
  }, 20_000);

  test("burst: 300 ms against a local target, latencies in order", async () => {
    // port 0 → the OS picks a free port, so --parallel runs never collide
    const target = Bun.serve({
      port: 0,
      fetch: () => Response.json({ deck: "test-target", ok: true }),
    });
    try {
      const report = await burst(target.url.href, 300);
      expect(report.requests).toBeGreaterThan(0);
      expect(report.reqPerSec).toBeGreaterThan(0);
      expect(report.bytesMoved).toBeGreaterThan(0);
      expect(report.durationMs).toBeGreaterThanOrEqual(300);
      expect(report.concurrency).toBeGreaterThan(0);

      const { p50Ms, p99Ms, maxMs } = report.latency;
      expect(p50Ms).toBeGreaterThan(0);
      expect(p50Ms).toBeLessThanOrEqual(p99Ms);
      expect(p99Ms).toBeLessThanOrEqual(maxMs);
    } finally {
      target.stop(true);
    }
  }, 15_000);
});
