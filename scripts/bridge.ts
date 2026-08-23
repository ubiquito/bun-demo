/**
 * Captain's Bridge — a live cockpit for the whole ship, standing on
 * `node:repl`: a stub for years, a real implementation as of Bun 1.4.
 * Every deck's engine is preloaded into the REPL context, top-level
 * `await` works at the prompt, and `.decks` is a custom house command
 * registered through the genuine `defineCommand` API.
 */
import repl from "node:repl";
import { join } from "node:path";
import { mkdirSync } from "node:fs";
import { bold, dim, emblemBanner, ok, paint, palette, warn } from "../src/lib/theme.ts";
import type { DeckStatus } from "../src/types.ts";
import { bake, ovenStatus } from "../src/systems/photon-oven.ts";
import { commsStatus, missionLog, renderAll } from "../src/systems/comms.ts";
import { chronometerStatus, windows } from "../src/systems/chronometer.ts";
import { engineStatus } from "../src/systems/engine-room.ts";
import { cargoStatus, inspect } from "../src/systems/cargo-hold.ts";
import { observationStatus } from "../src/systems/observation-deck.ts";
import { burst, reactorStatus, startupRace } from "../src/systems/reactor.ts";

// The decks write their artifacts to `.flight-data/…` relative paths;
// steering from the repo root keeps every helper honest wherever the
// captain boarded from.
process.chdir(join(import.meta.dir, ".."));

const MISSION_CONTROL = `http://${process.env.HOST ?? "127.0.0.1"}:${process.env.PORT ?? "1414"}`;

const ship = Object.freeze({
  name: "Oven-1",
  mission: "ORBITAL BAKERY",
  bun: Bun.version,
  revision: Bun.revision.slice(0, 9),
});

// ── deck roster ────────────────────────────────────────────────────────────
const roster: ReadonlyArray<{ emblem: string; name: string; probe: () => DeckStatus }> = [
  { emblem: "🥐", name: "Photon Oven", probe: ovenStatus },
  { emblem: "🔭", name: "Observation Deck", probe: observationStatus },
  { emblem: "📡", name: "Comms Bay", probe: commsStatus },
  { emblem: "🕰", name: "Chronometer", probe: chronometerStatus },
  { emblem: "⚙️", name: "Engine Room", probe: engineStatus },
  { emblem: "📦", name: "Cargo Hold", probe: cargoStatus },
  { emblem: "☢️", name: "Reactor", probe: reactorStatus },
];

/** Every deck reports to the bridge; a probe that faints is an offline deck, not a crash. */
function status(): void {
  console.log();
  for (const deck of roster) {
    let s: DeckStatus;
    try {
      s = deck.probe();
    } catch (err) {
      s = { online: false, note: `probe fainted: ${err instanceof Error ? err.message : String(err)}` };
    }
    const mark = s.online ? paint(palette.mint, "◆") : paint(palette.star, "◇");
    console.log(`  ${mark} ${deck.emblem}  ${bold(deck.name.padEnd(17))} ${dim("— " + s.note)}`);
  }
  console.log();
}

/**
 * The Reactor's burst cannon, aimed at Mission Control next door.
 * Probes first, so a dark tower gets a friendly word instead of a stack trace.
 */
async function burstAtMissionControl(durationMs = 1000, baseUrl = MISSION_CONTROL) {
  try {
    const probe = await fetch(new URL("/api/status", baseUrl), { signal: AbortSignal.timeout(1500) });
    if (!probe.ok) throw new Error(`answered ${probe.status}`);
  } catch {
    console.log(warn(
      `Mission Control isn't answering at ${baseUrl} — ` +
      "run `bun start` in another window, then fire `await burst()` again.",
    ));
    return; // ignoreUndefined keeps the line clean — the warning above is the whole answer
  }
  return burst(baseUrl, durationMs);
}

// ── the briefing (six lines of markdown, rendered by the Comms Bay's own array) ──
const BRIEFING = [
  "**Bridge console** — top-level `await` is live; every deck answers the captain:",
  "- `status()` musters every deck · `ship` says who we are · `help()` reprints this card",
  "- `await bake()` fires the Photon Oven through the full `Bun.Image` pipeline",
  "- `renderAll()` runs the mission log through all three Comms Bay renderers",
  '- `windows("@daily")` charts the Chronometer · `await inspect()` audits the Cargo Hold',
  "- `await startupRace()` drag-races cold starts · `await burst()` shells Mission Control (`bun start` first)",
].join("\n");

function briefing(): string {
  let rendered =
    typeof Bun.markdown?.ansi === "function"
      ? Bun.markdown.ansi(BRIEFING)
      : BRIEFING + "\n"; // comms array not aboard this hull — the plain text still briefs
  // markdown.ansi paints unconditionally; honor the ship-wide no-color discipline when piped
  if (!Bun.enableANSIColors) rendered = Bun.stripANSI(rendered);
  return rendered.trimEnd().split("\n").map(line => "  " + line).join("\n");
}

function help(): void {
  console.log();
  console.log(briefing());
  console.log();
  console.log(dim("  house commands: .decks musters the decks · .help lists everything · .exit (or Ctrl-D) docks"));
  console.log();
}

// ── welcome aboard ─────────────────────────────────────────────────────────
console.log(emblemBanner());
console.log();
console.log(dim(`   captain's bridge · node:repl, real as of 1.4 · bun ${Bun.version} · captain on deck`));
help();

const r = repl.start({
  prompt: paint(palette.flame, "oven-1 ▸ "),
  ignoreUndefined: true, // helpers that print for themselves shouldn't echo `undefined` after
  useColors: Bun.enableANSIColors,
});

/** Load the bridge console; `.clear` wipes the context, the `reset` event restocks it. */
function stock(context: Record<string, unknown>): void {
  Object.assign(context, {
    ship,
    status,
    help,
    bake,
    renderAll: (markdown: unknown = missionLog()) => renderAll(String(markdown)),
    missionLog,
    windows: (expr: unknown = "@hourly", count?: number) => windows(String(expr), count),
    inspect,
    startupRace,
    burst: burstAtMissionControl,
  });
}
stock(r.context);
r.on("reset", context => {
  console.log(dim("  console wiped — restocking the bridge…"));
  stock(context);
});

r.defineCommand("decks", {
  help: "Muster every deck of the Oven-1 for a status report",
  action() {
    status();
    this.displayPrompt();
  },
});

// The captain's command history rides in .flight-data with the other artifacts.
try {
  mkdirSync(".flight-data", { recursive: true });
  r.setupHistory(".flight-data/bridge.history", () => {});
} catch {
  // no history this voyage — the bridge sails on
}

r.on("exit", () => {
  console.log();
  console.log(ok(`docking clamps engaged — the bridge goes dark, the ovens stay warm. ${dim("(`bun start` lights the whole flight deck.)")}`));
  console.log();
  process.exit(0);
});
