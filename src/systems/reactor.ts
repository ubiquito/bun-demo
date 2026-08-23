/**
 * Reactor deck: honest performance, measured on this machine, right now.
 * `burst` turns the ship's own HTTP cannon on itself; `startupRace` drag-races
 * cold process starts. No cached numbers, no release-note quotes as data.
 */
import type { BurstReport, DeckStatus, StartupRaceReport } from "../types.ts";

const BURST_CONCURRENCY = 32;
const RACE_RUNS = 7;

export function reactorStatus(): DeckStatus {
  return {
    online: true,
    note: `mimalloc core steady — Bun ${Bun.version} (${Bun.revision.slice(0, 9)})`,
  };
}

export async function burst(baseUrl: string, durationMs: number): Promise<BurstReport> {
  const budget = Math.min(Math.max(durationMs, 1), 5000);
  const target = new URL("/api/status", baseUrl).href;
  const latenciesNs: number[] = [];
  let bytesMoved = 0;

  const start = Bun.nanoseconds();
  const deadline = start + budget * 1e6;

  const lane = async () => {
    while (Bun.nanoseconds() < deadline) {
      const t0 = Bun.nanoseconds();
      const res = await fetch(target);
      bytesMoved += (await res.arrayBuffer()).byteLength;
      latenciesNs.push(Bun.nanoseconds() - t0);
    }
  };
  await Promise.all(Array.from({ length: BURST_CONCURRENCY }, lane));
  const wallMs = (Bun.nanoseconds() - start) / 1e6;

  latenciesNs.sort((a, b) => a - b);
  const quantile = (q: number) =>
    (latenciesNs[Math.min(latenciesNs.length - 1, Math.floor(q * latenciesNs.length))] ?? 0) / 1e6;

  return {
    durationMs: Math.round(wallMs),
    concurrency: BURST_CONCURRENCY,
    requests: latenciesNs.length,
    reqPerSec: Math.round(latenciesNs.length / (wallMs / 1000)),
    latency: { p50Ms: quantile(0.5), p99Ms: quantile(0.99), maxMs: quantile(1) },
    bytesMoved,
  };
}

export async function startupRace(): Promise<StartupRaceReport> {
  const lanes = [
    raceLane(`bun ${Bun.version}`, "bun", process.execPath),
    raceLane(nodeLabel(), "node", Bun.which("node")),
  ];
  return {
    runs: RACE_RUNS,
    lanes,
    note:
      `Wall time to spawn and finish an empty program (\`-e ""\`): cold process start, ` +
      `best of ${RACE_RUNS} on this machine, just now. Nothing else is being compared.`,
  };
}

function raceLane(runtime: string, name: string, bin: string | null): StartupRaceReport["lanes"][number] {
  const cmd = `${name} -e ""`;
  if (!bin) {
    return { runtime, cmd, bestMs: 0, medianMs: 0, available: false };
  }
  const samples: number[] = [];
  // one unmeasured spawn first, so lane order doesn't decide who pays for page-cache warmup
  for (let i = 0; i <= RACE_RUNS; i++) {
    const t0 = Bun.nanoseconds();
    const run = Bun.spawnSync({ cmd: [bin, "-e", ""], stdout: "ignore", stderr: "ignore" });
    const ms = (Bun.nanoseconds() - t0) / 1e6;
    if (!run.success) return { runtime, cmd, bestMs: 0, medianMs: 0, available: false };
    if (i > 0) samples.push(ms);
  }
  samples.sort((a, b) => a - b);
  return { runtime, cmd, bestMs: samples[0]!, medianMs: samples[RACE_RUNS >> 1]!, available: true };
}

function nodeLabel(): string {
  const bin = Bun.which("node");
  if (!bin) return "node";
  const probe = Bun.spawnSync({ cmd: [bin, "--version"], stdout: "pipe", stderr: "ignore" });
  const version = probe.success ? probe.stdout.toString().trim() : "";
  return version ? `node ${version}` : "node";
}
