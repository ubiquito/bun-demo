/**
 * Cargo Hold, standalone: run every crate of the same manifest through its
 * native Bun parser, let Bun.deepEquals certify the dialects agree, then
 * pack the lot into a tarball with Bun.Archive and prove the roundtrip.
 */
import { bold, deck, dim, fail, fmt, gauge, ok, paint, palette, prose, rule } from "../src/lib/theme.ts";
import { cargoStatus, inspect } from "../src/systems/cargo-hold.ts";

const beat = () => Bun.sleep(110);

console.log(deck("📦", "Cargo Hold", "Bun.Archive + six native parsers — one manifest, every dialect, zero dependencies"));

const status = cargoStatus();
console.log(status.online ? ok(status.note) : fail(status.note));
if (!status.online) {
  console.log(dim("  Nothing to unload today — upgrade the hull to Bun ≥ 1.4 and the bay lights come on."));
  process.exit(0);
}

const report = await inspect();

const winks: Record<string, string> = {
  json5: "JSON, off duty",
  jsonc: "JSON with margin notes",
  jsonl: "an event per line",
  xml: "angle brackets, faithfully strings",
  yaml: "anchors aweigh",
  toml: "the quartermaster's ledger",
};

console.log();
console.log(dim("  ── parser bay · the same cargo, six dialects, each on its native parser ──"));
console.log();
for (const d of report.dialects) {
  console.log(gauge(
    `Bun.${d.name.toUpperCase()}.parse — ${winks[d.name]}`,
    fmt.us(d.parseUs),
    d.ok ? palette.mint : palette.alarm,
  ));
  console.log(dim(`      ${d.sample}`));
  await beat();
}

const core = report.dialects.filter(d => ["json5", "jsonc", "yaml", "toml"].includes(d.name));
const agree = core.every(d => d.ok);
console.log();
console.log(agree
  ? ok(`Bun.deepEquals(strict): json5 ≡ jsonc ≡ yaml ≡ toml — four dialects, one cargo`)
  : fail(`Bun.deepEquals(strict): the dialects disagree — check the flagged bays above`));

await beat();
const a = report.archive;
console.log();
console.log(dim("  ── tar crane · Bun.Archive ──"));
console.log();
console.log(gauge(
  `pack ${a.files.length} crates → ${a.name} (${a.format})`,
  `${fmt.bytes(a.bytes)} · ${fmt.ms(a.packMs)}`,
  palette.flame,
));
console.log(gauge("extract → .flight-data/cargo/extracted", fmt.ms(a.extractMs), palette.flame));

await beat();
console.log();
const wide = Math.max(...a.files.map(f => f.path.length));
console.log(dim(`      ${"crate".padEnd(wide)}   size`));
for (const f of a.files) {
  console.log(`      ${paint(palette.sky, f.path.padEnd(wide))}   ${paint(palette.star, fmt.bytes(f.size).padStart(7))}`);
}
const loaded = a.files.reduce((sum, f) => sum + f.size, 0);
console.log(dim(`      ${"─".repeat(wide + 10)}`));
console.log(`      ${bold("hold total".padEnd(wide))}   ${paint(palette.mint, fmt.bytes(loaded).padStart(7))}`);

await beat();
console.log();
console.log(a.roundtripOk
  ? ok("roundtrip verified — every crate re-read byte-for-byte identical to its source")
  : fail("roundtrip mismatch — a crate came back changed; do not sign the manifest"));

console.log();
console.log(rule());
console.log();
console.log(dim(prose(
  "Why it matters: reading a config used to mean picking an npm parser per format and " +
  "shipping five of them. Bun 1.4 parses JSON5, JSONC, JSONL, XML, YAML and TOML natively " +
  "in microseconds, checks structural equality with Bun.deepEquals, and tars the results " +
  "with Bun.Archive — a whole ETL toolbox in the runtime, zero dependencies.",
)));
console.log();

if (!agree || !a.roundtripOk) process.exitCode = 1;
