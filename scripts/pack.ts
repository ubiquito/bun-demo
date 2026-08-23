/**
 * Shipwright — the yard where the whole bakery becomes one file.
 * `bun build --compile` folds Mission Control — server, dashboard, every deck,
 * the cargo manifests, the Bun runtime itself — into a single executable,
 * then we PROVE it flies: cold-boot it from the gitignored yard — outside
 * the source tree, no source files in reach — and sweep every /api route.
 * Numbers below are measured on this machine, during this run.
 */
import { bold, deck, dim, fail, fmt, gauge, ok, paint, palette, prose, warn } from "../src/lib/theme.ts";
import { join } from "node:path";
import { existsSync } from "node:fs";

const ROOT = join(import.meta.dir, "..");
const YARD_REL = ".flight-data/shipwright";
const YARD = join(ROOT, YARD_REL);
const BINARY = join(YARD, "oven-1");

console.log(deck("⚒", "Shipwright", "bun build --compile — the whole bakery, one file, batteries and runtime included"));

// ── the build ───────────────────────────────────────────────────────────────
// --minify trims the transpiled decks; --bytecode stays ashore because it
// forces CJS and the pantry legitimately uses top-level await. Host triple
// only — cross-compiling is a --target flag away, but we only vouch for hulls
// we can launch.

const buildArgs = [
  process.execPath,
  "build",
  "--compile",
  "--minify",
  "src/server.ts",
  "--outfile",
  join(YARD_REL, "oven-1"),
];

console.log(dim(`  $ bun ${buildArgs.slice(1).join(" ")}`));
console.log();

const b0 = performance.now();
const build = Bun.spawn(buildArgs, { cwd: ROOT, stdout: "pipe", stderr: "pipe" });
const [buildOut, buildErr, buildExit] = await Promise.all([
  new Response(build.stdout).text(),
  new Response(build.stderr).text(),
  build.exited,
]);
const buildMs = performance.now() - b0;

if (buildExit !== 0 || !existsSync(BINARY)) {
  console.log("  " + fail(`the yard rejected the hull (bun build exited ${buildExit})`));
  console.log(prose((buildErr || buildOut).trim(), 4));
  process.exit(1);
}

// The build ledger: bun prints its own honest tally — read it back out.
const ledger = buildOut + buildErr;
const modules = ledger.match(/bundle\s+(\d+)\s+modules/)?.[1];
const minified = ledger.match(/minify\s+(-[\d.]+\s*[KM]B)/)?.[1];
const binaryBytes = Bun.file(BINARY).size;

console.log(gauge("bundle + compile, wall clock", fmt.ms(buildMs), palette.flame));
console.log(gauge("binary size (runtime aboard)", fmt.bytes(binaryBytes), palette.caramel));
if (modules) console.log(gauge("modules folded into the hull", modules, palette.sky));
if (minified) console.log(gauge("minifier shavings (bun's estimate)", minified, palette.hull));
console.log();

// ── the proof flight ────────────────────────────────────────────────────────
// Launch from the yard itself — gitignored, outside the source tree — so
// every route has to survive on what the binary carries. Cold-boot is measured from
// the moment the OS gets the spawn to the first 200 OK, polling every ~4 ms;
// the poll interval is inside the number, not subtracted out.

// A berth is free only if we can actually moor there: bind, then let go.
// (An HTTP knock can't tell an empty berth from a silent TCP occupant.)
function portLooksFree(port: number): boolean {
  try {
    const probe = Bun.listen({ hostname: "127.0.0.1", port, socket: { data() {} } });
    probe.stop(true);
    return true;
  } catch {
    return false;
  }
}

let port = 14499;
while (!portLooksFree(port)) port++;

console.log("  " + ok(`launching ${bold("oven-1")} from ${paint(palette.sky, YARD_REL + "/")} — outside the source tree, PORT=${port}`));

const base = `http://127.0.0.1:${port}`;
const t0 = performance.now();
const ship = Bun.spawn([BINARY], {
  cwd: YARD,
  env: { ...process.env, PORT: String(port) },
  stdout: "pipe",
  stderr: "pipe",
});

let coldBootMs = NaN;
let status: { bun: { version: string; revision: string }; decks: Record<string, { online: boolean }> } | undefined;
const deadline = performance.now() + 15_000;
while (performance.now() < deadline) {
  try {
    const res = await fetch(`${base}/api/status`, { signal: AbortSignal.timeout(1000) });
    if (res.ok) {
      coldBootMs = performance.now() - t0;
      status = await res.json();
      break;
    }
  } catch {
    // hatch not open yet — keep knocking
  }
  await Bun.sleep(4);
}

if (!status) {
  ship.kill();
  console.log("  " + fail("the binary never answered /api/status — flight scrubbed. Its last words:"));
  console.log(prose((await new Response(ship.stderr).text()).trim() || "(silence)", 4));
  process.exit(1);
}

const decksOnline = Object.values(status.decks).filter(d => d.online).length;
console.log();
console.log(gauge("cold boot → first 200 OK", fmt.ms(coldBootMs), palette.mint));
console.log(gauge("bun runtime inside the hull", `${status.bun.version} (${status.bun.revision.slice(0, 9)})`, palette.glow));
console.log(gauge("decks reporting online", `${decksOnline}/7`, palette.sky));
console.log();

// ── the route sweep ─────────────────────────────────────────────────────────

let hardFailures = 0;

async function check(label: string, run: () => Promise<string>): Promise<void> {
  try {
    console.log("  " + ok(`${label} — ${await run()}`));
  } catch (err) {
    hardFailures++;
    console.log("  " + fail(`${label} — ${(err as Error).message}`));
  }
}

const json = async (path: string, init?: RequestInit) => {
  const res = await fetch(`${base}${path}`, init);
  if (!res.ok) throw new Error(`${path} answered ${res.status}`);
  return res.json();
};
const post = (path: string, body?: unknown) =>
  json(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });

await check("GET  /", async () => {
  const res = await fetch(`${base}/`);
  const html = await res.text();
  if (!res.ok || !html.includes("Mission Control")) throw new Error("dashboard did not render");
  const assets = [...new Set(html.match(/\/chunk-[a-z0-9]+\.(?:js|css)/g) ?? [])];
  for (const asset of assets) {
    const hit = await fetch(`${base}${asset}`);
    if (!hit.ok) throw new Error(`embedded asset ${asset} answered ${hit.status}`);
  }
  return `dashboard up, ${assets.length} embedded frontend assets served from the hull (${assets.join(", ")})`;
});

await check("POST /api/oven/bake", async () => {
  const r = await post("/api/oven/bake", { width: 128 });
  if (!Array.isArray(r.outputs) || r.outputs.length < 7) throw new Error("oven under-delivered");
  return `${r.outputs.length} assets in ${fmt.ms(r.totalMs)} — nebula repainted into the yard's own pantry`;
});

await check("GET  /api/oven/asset", async () => {
  const res = await fetch(`${base}/api/oven/asset/nebula-128.webp`);
  if (!res.ok) throw new Error(`asset route answered ${res.status}`);
  return `nebula-128.webp, ${fmt.bytes((await res.arrayBuffer()).byteLength)}, ${res.headers.get("content-type")}`;
});

await check("POST /api/comms/render", async () => {
  const r = await post("/api/comms/render", { markdown: "# Yard check\n**one** file, *three* renderers" });
  if (!r.html?.includes("<h1") || !r.ansi || !r.custom) throw new Error("a renderer came back empty");
  return `html ${fmt.us(r.timings.htmlUs)} · ansi ${fmt.us(r.timings.ansiUs)} · transcript ${fmt.us(r.timings.customUs)}`;
});

await check("GET  /api/chronometer/windows", async () => {
  const r = await json(`/api/chronometer/windows?expr=${encodeURIComponent("*/15 * * * *")}&count=3`);
  if (!r.valid || r.next.length !== 3) throw new Error("the chronometer lost the beat");
  return `3 windows parsed, ${r.jobs.length} live jobs ticking inside the binary`;
});

await check("POST /api/cargo/inspect", async () => {
  const r = await post("/api/cargo/inspect");
  const okDialects = r.dialects.filter((d: { ok: boolean }) => d.ok).length;
  if (okDialects !== 6 || !r.archive.roundtripOk) throw new Error(`${okDialects}/6 dialects, roundtrip ${r.archive.roundtripOk}`);
  return `6/6 dialects agree from embedded manifests, tar roundtrip ${fmt.ms(r.archive.packMs + r.archive.extractMs)}`;
});

await check("POST /api/reactor/burst", async () => {
  const r = await post("/api/reactor/burst", { durationMs: 500 });
  return `${fmt.int(r.requests)} req in ${fmt.ms(r.durationMs)} — ${fmt.int(r.reqPerSec)} req/s, p99 ${fmt.ms(r.latency.p99Ms)}`;
});

// The Observation Deck needs a Chrome-family browser wherever the binary
// lands — ok:false is the documented soft landing, not a packing defect.
try {
  const snap = await post("/api/observation/snapshot");
  console.log(
    "  " +
      (snap.ok
        ? ok(`POST /api/observation/snapshot — ${snap.asset?.name} (${fmt.bytes(snap.asset?.bytes ?? 0)})`)
        : warn(`POST /api/observation/snapshot — idles softly: ${snap.reason}`)),
  );
} catch (err) {
  hardFailures++;
  console.log("  " + fail(`POST /api/observation/snapshot — ${(err as Error).message}`));
}

if (existsSync(join(YARD, ".flight-data"))) {
  console.log("  " + ok("the binary kept its own flight recorder — .flight-data/ grew beside it in the yard, not at the repo root"));
} else {
  hardFailures++;
  console.log("  " + fail("the binary left no .flight-data beside itself — the recorder is missing"));
}

ship.kill();
await ship.exited;

// ── debrief ─────────────────────────────────────────────────────────────────

console.log();
if (hardFailures > 0) {
  console.log("  " + fail(`${hardFailures} route(s) failed inside the hull — the yard does not sign this one`));
  process.exit(1);
}

console.log("  " + ok(`flight proven — every deck answered from a single ${fmt.bytes(binaryBytes)} file`));
console.log();
console.log(
  prose(
    dim(
      `The hull is ${YARD_REL}/oven-1 — copy it to any machine matching this one's triple ` +
        `(${process.platform}-${process.arch}) and run it; no Bun, no node_modules, no source. ` +
        `Bun.isStandaloneExecutable and Bun.embeddedFiles are only visible to code riding inside the hull ` +
        `(that's how the pantry knows to repaint into .flight-data); out here in the yard, ` +
        `bun's own build ledger${modules ? ` — ${modules} modules folded in —` : ""} and the asset sweep above are the receipts.`,
    ),
  ),
);
console.log();
