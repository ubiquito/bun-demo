/**
 * The Grand Tour: every deck of the Oven-1, in order, in one sitting.
 * Each act is the standalone demo running as its own process — exactly
 * what a visitor gets from `bun demos/NN-*.ts` — with the tour keeping
 * time and holding the curtain. A stumbling act is noted, never fatal.
 */
import { bold, dim, emblemBanner, fmt, gauge, ok, paint, palette, rule, warn } from "../src/lib/theme.ts";

const ROOT = new URL("..", import.meta.url).pathname;

const acts = [
  { emblem: "🥐", name: "Photon Oven", file: "demos/01-photon-oven.ts" },
  { emblem: "🔭", name: "Observation Deck", file: "demos/02-observation-deck.ts" },
  { emblem: "📡", name: "Comms Bay", file: "demos/03-comms.ts" },
  { emblem: "🕰", name: "Chronometer", file: "demos/04-chronometer.ts" },
  { emblem: "⚙️", name: "Engine Room", file: "demos/05-engine-room.ts" },
  { emblem: "📦", name: "Cargo Hold", file: "demos/06-cargo-hold.ts" },
  { emblem: "☢️", name: "Reactor", file: "demos/07-reactor.ts" },
  { emblem: "🌀", name: "Hyperdrive", file: "demos/08-hyperdrive.ts" },
] as const;

console.log();
console.log(emblemBanner());
console.log();
console.log(dim(`   the grand tour · ${acts.length} decks · bun ${Bun.version} · departing now`));

const liftoff = performance.now();
const log: { name: string; emblem: string; ms: number; code: number }[] = [];

for (const [i, act] of acts.entries()) {
  console.log();
  console.log(rule(palette.caramel));
  console.log(
    `${paint(palette.caramel, `ACT ${i + 1} of ${acts.length}`)}  ${act.emblem}  ` +
    `${bold(act.name)}  ${dim(`· bun ${act.file}`)}`,
  );

  const t0 = performance.now();
  const code = await Bun.spawn({
    cmd: ["bun", act.file],
    cwd: ROOT,
    stdio: ["inherit", "inherit", "inherit"],
  }).exited;
  const ms = performance.now() - t0;
  log.push({ name: act.name, emblem: act.emblem, ms, code });

  if (code === 0) {
    console.log(gauge(`act ${i + 1} curtain — ${act.name}`, fmt.ms(ms), palette.mint));
  } else {
    console.log(warn(`${act.name} left the stage early (exit ${code}) — the tour sails on`));
  }
}

const totalMs = performance.now() - liftoff;
const flawless = log.filter(a => a.code === 0);

console.log();
console.log(rule(palette.glow));
console.log(`${paint(palette.glow, bold("CURTAIN CALL"))}  ${dim("· the whole ship, one pass")}`);
console.log();
for (const a of log) {
  console.log(gauge(
    `${a.emblem}  ${a.name}`,
    a.code === 0 ? fmt.ms(a.ms) : `exit ${a.code}`,
    a.code === 0 ? palette.mint : palette.star,
  ));
}
console.log(gauge("full tour, wheels-stop", fmt.ms(totalMs), palette.flame));
console.log();
console.log(flawless.length === acts.length
  ? ok(`all ${acts.length} decks performed — every number above measured on this pass`)
  : warn(`${flawless.length} of ${acts.length} decks performed — the marked acts sat this one out`));
console.log();
console.log(dim("  For the interactive show, run `bun start` — Mission Control on http://localhost:1414."));
console.log();
