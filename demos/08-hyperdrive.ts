/**
 * Hyperdrive, standalone: Bun 1.4's parallel CLI, measured honestly.
 * Act one races `bun run --sequential` against `bun run --parallel` over
 * three real demos; act two races the preflight suite one lane vs N.
 * Every number is wall-clock, from this machine, from this run.
 */
import { bold, deck, dim, fail, fmt, gauge, ok, paint, palette, prose, rule, warn } from "../src/lib/theme.ts";

import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");

interface Run {
  ms: number;
  code: number;
  text: string;
}

async function timed(cmd: string[]): Promise<Run> {
  const t0 = performance.now();
  const proc = Bun.spawn({ cmd, cwd: ROOT, stdout: "pipe", stderr: "pipe", env: process.env });
  // Drain the pipes via Response — same trick as the Engine Room, and the
  // type-checker knows this route (the pinned bun-types predate stream.text()).
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { ms: performance.now() - t0, code, text: out + err };
}

console.log(deck("🌀", "Hyperdrive", "bun run --parallel + bun test --parallel — the whole fleet, every engine at once"));

const probe = await timed([process.execPath, "run", "--help"]);
if (!probe.text.includes("--parallel")) {
  console.log(warn("no hyperdrive coils on this hull — `bun run --parallel` ships with Bun 1.4"));
  console.log(dim("  Upgrade the reactor (bun upgrade) and the jump drive comes online."));
  process.exit(0);
}
console.log(ok("hyperdrive coils charged — --parallel, --sequential, and --no-exit-on-error all report ready"));

// ── act one · convoy run ────────────────────────────────────────────────────
const convoy = ["demo:comms", "demo:chronometer", "demo:cargo"];
console.log();
console.log(dim(`  ── convoy run · three demos, one command, two schedulers ──`));
console.log();
console.log(dim(`  $ bun run --sequential ${convoy.join(" ")}`));
const seq = await timed([process.execPath, "run", "--sequential", ...convoy]);
console.log(gauge("one engine at a time", fmt.ms(seq.ms), palette.sky));

console.log();
console.log(dim(`  $ bun run --parallel ${convoy.join(" ")}`));
const par = await timed([process.execPath, "run", "--parallel", ...convoy]);
console.log(gauge("all three at once", fmt.ms(par.ms), palette.flame));

const bothOk = seq.code === 0 && par.code === 0;
if (bothOk) {
  const speedup = seq.ms / par.ms;
  console.log(gauge("convoy speedup", `×${speedup.toFixed(2)}`, speedup > 1 ? palette.mint : palette.star));
} else {
  console.log(fail("a convoy ship reported trouble — timings above still honest, verdict withheld"));
}

// Foreman-style excerpt: the parallel run, verbatim, prefixes and all.
const lanes: Record<string, string> = {
  "demo:comms": palette.glow,
  "demo:chronometer": palette.sky,
  "demo:cargo": palette.caramel,
};
const prefixed = par.text.split("\n").filter(l => /^\S+\s+\| \S/.test(l));
console.log();
console.log(dim("  ── flight recorder · Foreman-style prefixes, three ships interleaved ──"));
console.log();
for (const line of prefixed.slice(0, 9)) {
  const cut = line.indexOf("|");
  const lane = line.slice(0, cut);
  console.log(`  ${paint(lanes[lane.trim()] ?? palette.hull, lane)}${dim("│")} ${line.slice(cut + 2)}`);
}
if (prefixed.length > 9) console.log(dim(`  … ${prefixed.length - 9} more lines in the recorder`));
console.log();
console.log(dim(prose(
  "Also aboard: the same flags span monorepos — `bun run --parallel --filter '*' build` " +
  "fans a script across workspace packages, `--workspaces` hits them all, and " +
  "`--no-exit-on-error` keeps the convoy moving when one ship stumbles.",
)));

// ── act two · preflight, one lane vs N ──────────────────────────────────────
console.log();
console.log(dim("  ── proving grounds · the preflight suite, one lane vs a wall of workers ──"));
console.log();

function suite(run: Run): { summary: string; workers?: string } {
  const counts = run.text.match(/(\d+) pass[\s\S]*?(\d+) fail[\s\S]*?Ran (\d+) tests across (\d+) files/);
  const workers = run.text.match(/(\d+)x PARALLEL/)?.[1];
  return {
    summary: counts ? `${counts[3]} tests · ${counts[4]} files · ${counts[1]} pass · ${counts[2]} fail` : "summary unreadable",
    workers,
  };
}

console.log(dim("  $ bun test"));
const serial = await timed([process.execPath, "test"]);
const serialInfo = suite(serial);
console.log(gauge(`single lane — ${serialInfo.summary}`, fmt.ms(serial.ms), palette.sky));

console.log();
console.log(dim("  $ bun test --parallel"));
const parallel = await timed([process.execPath, "test", "--parallel"]);
const parallelInfo = suite(parallel);
console.log(gauge(
  `${parallelInfo.workers ?? "?"} worker processes — ${parallelInfo.summary}`,
  fmt.ms(parallel.ms),
  palette.flame,
));

const testsOk = serial.code === 0 && parallel.code === 0;
console.log();
if (!testsOk) {
  console.log(fail("preflight reported failures — see `bun test` for the full transcript"));
} else if (parallel.ms < serial.ms) {
  console.log(ok(`hyperdrive gain on this suite: ×${(serial.ms / parallel.ms).toFixed(2)} — files fan out, reports merge back to one`));
} else {
  console.log(warn(`hyperdrive spin-up costs more than the trip on ${dim("this")} suite — worth it on bigger cargo`));
  console.log(dim(`  ${parallelInfo.workers ?? "N"} workers took ${fmt.ms(parallel.ms - serial.ms)} longer: small suites finish before the crew is seated.`));
}

console.log();
console.log(rule());
console.log();
console.log(dim(prose(
  "Why it matters: parallelism used to be an npm install — concurrently for scripts, a " +
  "runner-of-runners for tests. Bun 1.4 builds both into the CLI: `bun run --parallel` " +
  "multiplexes scripts with Foreman-style prefixes, and `bun test --parallel` spreads test " +
  "files across isolated worker processes and merges the results into one honest report.",
)));
console.log();

if (!bothOk || !testsOk) process.exitCode = 1;
