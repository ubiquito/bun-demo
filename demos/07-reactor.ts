/**
 * Reactor, standalone: light a throwaway Bun.serve on a random port, turn the
 * ship's HTTP cannon on it for two seconds, read the reactor's own vitals
 * while it burns, then drag-race cold starts against whatever node is aboard.
 */
import { bold, deck, dim, fmt, gauge, ok, paint, palette, prose, rule, warn } from "../src/lib/theme.ts";
import { startTelemetry } from "../src/telemetry.ts";
import { burst, reactorStatus, startupRace } from "../src/systems/reactor.ts";
import type { TelemetryFrame } from "../src/types.ts";

const beat = () => Bun.sleep(150);

console.log(deck("☢️", "Reactor", "mimalloc-era memory · self-inflicted throughput · a cold-start drag race"));
console.log(ok(reactorStatus().note));

let served = 0;
const server = Bun.serve({
  port: 0,
  routes: {
    "/api/status": () => {
      served++;
      return Response.json({ ship: "Oven-1", reactor: "critical (the good kind)", t: Date.now() });
    },
  },
});
console.log(dim(`  test article lit on ${server.url.origin} — a one-route JSON server, born for this`));

const frames: TelemetryFrame[] = [];
const stopTelemetry = startTelemetry({
  getServerCounts: () => ({
    pendingRequests: server.pendingRequests,
    pendingWebSockets: server.pendingWebSockets,
  }),
  getRequestsServed: () => served,
  publish: frame => frames.push(frame),
  intervalMs: 250,
});

await beat();
console.log();
console.log(dim("  ── burn 1 · full thrust — 32 lanes of sequential fetches, 2 seconds ──"));
console.log();

const burn = await burst(server.url.origin, 2000);

const headline = `${fmt.int(burn.reqPerSec)} requests / second`;
const inner = `   ${headline}   `;
const bar = "─".repeat(Bun.stringWidth(inner));
console.log(paint(palette.flame, `  ┌${bar}┐`));
console.log(paint(palette.flame, "  │") + bold(paint(palette.flame, inner)) + paint(palette.flame, "│"));
console.log(paint(palette.flame, `  └${bar}┘`));
console.log();
console.log(gauge("requests completed", `${fmt.int(burn.requests)} in ${fmt.ms(burn.durationMs)}`, palette.sky));
console.log(gauge("concurrency", `${burn.concurrency} lanes`, palette.sky));
console.log(gauge("latency p50", fmt.ms(burn.latency.p50Ms)));
console.log(gauge("latency p99", fmt.ms(burn.latency.p99Ms), palette.star));
console.log(gauge("latency max", fmt.ms(burn.latency.maxMs), palette.star));
console.log(gauge("payload moved", fmt.bytes(burn.bytesMoved), palette.caramel));

await beat();
console.log();
console.log(dim("  ── reactor vitals, sampled every 250 ms while it burned ──"));
console.log();
if (frames.length > 0) {
  const peakCpu = Math.max(...frames.map(f => f.cpu));
  const worstLag = Math.max(...frames.map(f => f.loopLagMs));
  const last = frames[frames.length - 1]!;
  console.log(gauge(`peak cpu across ${frames.length} frames`, `${(peakCpu * 100).toFixed(0)} % of one core`, palette.flame));
  console.log(gauge("worst event-loop lag", fmt.ms(worstLag)));
  console.log(gauge("requests served (telemetry counter)", fmt.int(last.requestsServed), palette.sky));
} else {
  console.log(warn("no frames landed — the burn outran the heartbeat"));
}

await beat();
console.log();
console.log(dim('  ── burn 2 · cold-start drag race — wall time to run `-e ""`, best of 7 ──'));
console.log();

const race = await startupRace();
const ready = race.lanes.filter(l => l.available);
const slowest = Math.max(...ready.map(l => l.medianMs), 1);
const winner = ready.toSorted((a, b) => a.medianMs - b.medianMs)[0];
const label = Math.max(...race.lanes.map(l => Bun.stringWidth(l.runtime))) + 2;

for (const lane of race.lanes) {
  const name = lane.runtime.padEnd(label);
  if (!lane.available) {
    console.log(`  ${name}${dim("── not aboard this vessel — lane closed, race goes on")}`);
    continue;
  }
  const color = lane === winner ? palette.flame : palette.hull;
  const track = paint(color, "█".repeat(Math.max(2, Math.round((lane.medianMs / slowest) * 36))));
  const times = `median ${fmt.ms(lane.medianMs)} · best ${fmt.ms(lane.bestMs)}`;
  const flag = lane === winner ? paint(palette.flame, "  ⚑ first across") : "";
  console.log(`  ${bold(name)}${track} ${times}${flag}`);
}
console.log();
console.log(prose(dim(race.note)));

await beat();
console.log();
console.log(dim("  ── the reactor core itself, after all that ──"));
console.log();
const mem = process.memoryUsage();
console.log(gauge("resident set (rss)", fmt.bytes(mem.rss), palette.mint));
console.log(gauge("js heap used", fmt.bytes(mem.heapUsed), palette.mint));

stopTelemetry();
server.stop(true);

console.log();
console.log(rule());
console.log(dim(
  "  One runtime played server, load cannon, stopwatch, and flight recorder — zero tools installed,\n" +
  "  and every number above was measured on this machine during this run.",
));
