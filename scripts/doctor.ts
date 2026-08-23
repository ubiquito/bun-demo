/**
 * Ship's Surgeon — a pre-flight physical for whatever machine the Oven-1
 * just landed on. Eleven vitals, honest gauges, no needles, under ten seconds.
 *
 * Only one condition grounds the ship: a reactor older than Bun 1.4.
 * Everything else is advisory — a ◇ tells you which deck will dim and how
 * to light it, and the ship flies anyway.
 */

import { statfsSync } from "node:fs";
import { join } from "node:path";
import { detectCarrier } from "../src/lib/postcard";
import { bold, deck, dim, fail, fmt, gauge, ok, palette, warn } from "../src/lib/theme";
import { observationStatus } from "../src/systems/observation-deck";

// Examine the ship from her own deck, wherever the crew launched from.
process.chdir(join(import.meta.dir, ".."));

const t0 = performance.now();
console.log(deck("🩺", "Ship's Surgeon", "pre-flight physical — every vital measured on this machine, right now"));

type Pulse = "ok" | "warn" | "fail";
let warns = 0;
let fails = 0;

/** One vital per line: status mark + dotted gauge, plus a dim remedy when unwell. */
function vital(pulse: Pulse, label: string, value: string, remedy?: string) {
  const color = pulse === "ok" ? palette.mint : pulse === "warn" ? palette.star : palette.alarm;
  const mark = pulse === "ok" ? ok : pulse === "warn" ? warn : fail;
  // gauge() opens with a left margin; the status mark takes its seat.
  console.log(mark(gauge(label, value, color).trimStart()));
  if (pulse !== "ok" && remedy) console.log(dim(`    ↳ ${remedy}`));
  if (pulse === "warn") warns++;
  if (pulse === "fail") fails++;
}

// ── 1 · reactor grade — the one non-negotiable ─────────────────────────────
if (Bun.semver.satisfies(Bun.version, ">=1.4.0")) {
  vital("ok", "bun (the reactor)", `${Bun.version} — 1.4-grade, rated for orbit`);
} else {
  vital(
    "fail",
    "bun (the reactor)",
    `${Bun.version} — this ship needs >= 1.4.0`,
    "bun upgrade  (every deck aboard is built on the 1.4 engines)",
  );
}

// ── 2 · hull — platform and architecture ───────────────────────────────────
vital("ok", "hull (platform/arch)", `${process.platform}/${process.arch}`);

// ── 3 · engine cores — lanes for --parallel ────────────────────────────────
const cores = navigator.hardwareConcurrency;
if (cores >= 2) {
  vital("ok", "engine cores", `${cores} — bun run --parallel gets ${cores} lanes`);
} else {
  vital(
    "warn",
    "engine cores",
    `${cores} — the Hyperdrive runs single-lane`,
    "--parallel still works, it just queues; more cores, more show",
  );
}

// ── 4 · observation glass — a Chrome-family browser for Bun.WebView ────────
const obs = observationStatus();
vital(
  obs.online ? "ok" : "warn",
  "observation glass (WebView)",
  obs.note,
  "apt install chromium — or point BUN_CHROME_PATH at any Chrome/Chromium/Edge/Brave binary",
);

// ── 5 · launch pad — port 1414 ─────────────────────────────────────────────
try {
  const pad = Bun.listen({ hostname: "127.0.0.1", port: 1414, socket: { data() {} } });
  pad.stop(true);
  vital("ok", "launch pad (port 1414)", "clear — bun start has a runway");
} catch {
  // Someone is docked. Knock politely and see if it's one of ours.
  let occupant = "something that doesn't speak HTTP";
  try {
    const res = await fetch("http://127.0.0.1:1414/api/status", {
      signal: AbortSignal.timeout(900),
    });
    occupant =
      res.headers.get("x-ship") === "Oven-1"
        ? "an Oven-1 is already flying from here"
        : `an unknown HTTP craft (status ${res.status})`;
  } catch {}
  vital(
    "warn",
    "launch pad (port 1414)",
    `busy — ${occupant}`,
    "lsof -i :1414 names the occupant; PORT=1500 bun start lifts off from another pad",
  );
}

// ── 6 · certificate forge — openssl, for the Warp Drive ────────────────────
const openssl = Bun.which("openssl");
vital(
  openssl ? "ok" : "warn",
  "certificate forge (openssl)",
  openssl ? `${openssl} — warp-ready` : "not aboard — the Warp Drive can't forge a cert",
  "apt install openssl  (bun run warp self-signs its own TLS)",
);

// ── 7 · cockpit glass — terminal color ─────────────────────────────────────
if (Bun.enableANSIColors) {
  vital("ok", "cockpit glass (color)", "truecolor ANSI — full paint job");
} else {
  vital(
    "warn",
    "cockpit glass (color)",
    "monochrome — piped, dumb terminal, or NO_COLOR",
    "run in a live terminal for the full paint job; the numbers are identical either way",
  );
}

// ── 8 · cockpit glass — inline graphics (postcards) ────────────────────────
const carrier = detectCarrier();
if (carrier.protocol === "kitty") {
  vital("ok", "cockpit glass (graphics)", `Kitty graphics protocol (${carrier.via}) — postcards render inline`);
} else if (carrier.protocol === "iterm2") {
  vital("ok", "cockpit glass (graphics)", `iTerm2 inline images (${carrier.via}) — postcards render inline`);
} else {
  vital(
    "warn",
    "cockpit glass (graphics)",
    "no inline graphics — postcards fall back to saved files",
    "kitty, WezTerm, Konsole, or iTerm2 would show screenshots right in the terminal",
  );
}

// ── 9 · cargo bay — disk under .flight-data ────────────────────────────────
const hold = (() => {
  try {
    if (typeof statfsSync === "function") {
      const s = statfsSync(".");
      return { bytes: Number(s.bavail) * Number(s.bsize), via: "statfs" };
    }
  } catch {}
  try {
    const df = Bun.spawnSync(["df", "-k", "."], { stdout: "pipe", stderr: "ignore" });
    const avail = Number(df.stdout.toString().trim().split("\n").at(-1)?.split(/\s+/)[3]);
    if (df.exitCode === 0 && Number.isFinite(avail)) return { bytes: avail * 1024, via: "df" };
  } catch {}
  return null;
})();
if (!hold) {
  vital(
    "warn",
    "cargo bay (.flight-data disk)",
    "unmeasured — no statfs, no df on this hull",
    "the ship trusts you have room; artifacts run a few MB per sortie",
  );
} else if (hold.bytes >= 256 * 1024 * 1024) {
  // fmt.bytes tops out at MiB; a healthy hold deserves the bigger unit.
  const roomy =
    hold.bytes >= 1024 ** 3 ? `${(hold.bytes / 1024 ** 3).toFixed(1)} GiB` : fmt.bytes(hold.bytes);
  vital("ok", "cargo bay (.flight-data disk)", `${roomy} free (via ${hold.via})`);
} else {
  vital(
    "warn",
    "cargo bay (.flight-data disk)",
    `${fmt.bytes(hold.bytes)} free — snug for baked assets`,
    "rm -rf .flight-data reclaims every artifact; it regenerates on demand",
  );
}

// ── 10 · rival racer — node, for startup-race lane 2 ───────────────────────
const node = Bun.which("node");
if (node) {
  const v = Bun.spawnSync([node, "--version"], { stdout: "pipe", stderr: "ignore" })
    .stdout.toString()
    .trim();
  vital("ok", "rival racer (node)", `${v || "present"} at ${node} — startup race, lane 2 open`);
} else {
  vital(
    "warn",
    "rival racer (node)",
    "not aboard — the startup race flies bun-only",
    "optional: install node and demo 07 races the two cold starts side by side",
  );
}

// ── 11 · logbook — git ─────────────────────────────────────────────────────
const git = Bun.which("git");
vital(
  git ? "ok" : "warn",
  "logbook (git)",
  git ? `${git}` : "not aboard — history unwritten",
  "apt install git  (optional — the demos fly fine without a logbook)",
);

// ── verdict ────────────────────────────────────────────────────────────────
console.log();
if (fails === 0) {
  const aside =
    warns === 0
      ? "a perfect physical"
      : `${warns} advisory ${warns === 1 ? "note" : "notes"} logged; she flies fine without them`;
  console.log(ok(`${bold("cleared for liftoff")} ${dim(`— ${aside}`)}`));
} else {
  console.log(fail(bold("grounded until the above heals")));
}
console.log(dim(gauge("full physical", fmt.ms(performance.now() - t0))));
console.log();
process.exit(fails > 0 ? 1 : 0);
