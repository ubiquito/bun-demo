/**
 * Chronometer — the ship's Bun.cron deck. `windows()` charts when any
 * schedule will next fire by chaining `Bun.cron.parse()`; `startShipJobs()`
 * puts the bakery's own routines on the wheel as in-process cron jobs.
 */
import type { CronReport, DeckStatus } from "../types.ts";

interface ShipJob {
  name: string;
  expr: string;
  runs: number;
  lastRun?: string;
  handle?: Bun.CronJob;
}

const SHIP_SCHEDULE: ReadonlyArray<{ name: string; expr: string }> = [
  { name: "proof-rise-check", expr: "* * * * *" }, // dough waits for no one
  { name: "oven-rotation", expr: "*/5 * * * *" },
  { name: "daily-inventory", expr: "@daily" },
];

// Run counts live on globalThis so `bun --hot` reloads keep the tally;
// Bun stops the old jobs itself before re-evaluating this module.
const registry: Map<string, ShipJob> = ((globalThis as Record<symbol, unknown>)[
  Symbol.for("oven1.chronometer.registry")
] ??= new Map()) as Map<string, ShipJob>;

let armed = false;

export function chronometerStatus(): DeckStatus {
  if (typeof Bun.cron !== "function" || typeof Bun.cron.parse !== "function") {
    return { online: false, note: "Bun.cron not aboard — this hull predates the chronometer (needs Bun ≥ 1.4)" };
  }
  const ticking = [...registry.values()].filter(j => j.handle).length;
  return {
    online: true,
    note: ticking
      ? `ticking — ${ticking} ship routines on the wheel`
      : "ticking — wheel clear, no ship routines registered yet",
  };
}

function jobsSnapshot(): CronReport["jobs"] {
  return [...registry.values()].map(({ name, expr, runs, lastRun }) => ({
    name,
    expr,
    runs,
    ...(lastRun ? { lastRun } : {}),
  }));
}

/**
 * Chart the next `count` firing instants for a cron expression.
 * Invalid expressions come back as a calm `{ valid: false }` report carrying
 * the parser's own message — this function never throws.
 */
export function windows(expr: string, count = 5): CronReport {
  const jobs = jobsSnapshot();
  const wanted = Math.min(Math.max(Math.trunc(count) || 1, 1), 100);
  try {
    const next: string[] = [];
    let cursor: Date | number = Date.now();
    for (let i = 0; i < wanted; i++) {
      const hit = Bun.cron.parse(expr, cursor);
      if (!hit) break; // parseable, but no occurrence within 8 years (e.g. Feb 30)
      next.push(hit.toISOString());
      cursor = hit;
    }
    return { expr, valid: true, next, jobs };
  } catch (err) {
    return {
      expr,
      valid: false,
      error: err instanceof Error ? err.message : String(err),
      next: [],
      jobs,
    };
  }
}

/** Put the ship's routines on the wheel. Safe to call twice — jobs never stack. */
export function startShipJobs(onPulse: (job: string) => void): void {
  if (armed) return;
  armed = true;
  for (const { name, expr } of SHIP_SCHEDULE) {
    const job = registry.get(name) ?? { name, expr, runs: 0 };
    registry.set(name, job);
    job.handle?.stop(); // stale handle from a previous --hot evaluation
    job.handle = Bun.cron(expr, () => {
      job.runs += 1;
      job.lastRun = new Date().toISOString();
      onPulse(name);
    });
  }
}

/** Take every routine off the wheel so the process is free to land. */
export function stopShipJobs(): void {
  for (const job of registry.values()) {
    job.handle?.stop();
    job.handle = undefined;
  }
  armed = false;
}
