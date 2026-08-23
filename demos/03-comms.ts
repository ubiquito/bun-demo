/**
 * Comms Bay, standalone: replay the mission log through Bun.markdown's
 * built-in ANSI pass, then re-key an excerpt through the custom transcript
 * renderer, then read the dials.
 */
import { deck, dim, fmt, gauge, ok, palette, prose, rule } from "../src/lib/theme.ts";
import { commsStatus, missionLog, renderAll } from "../src/systems/comms.ts";

const beat = () => Bun.sleep(120);

console.log(deck("📡", "Comms Bay", "Bun.markdown — one log, three renderers: html, ansi, and full custom control"));

const status = commsStatus();
console.log(ok(status.note));

const log = missionLog();
const report = renderAll(log);

await beat();
console.log();
console.log(dim("  ── channel 1 · Bun.markdown.ansi — the built-in terminal pass ──"));
console.log();
console.log(report.ansi);

await beat();
console.log(dim("  ── channel 2 · Bun.markdown.render — the same log, re-keyed as a transcript ──"));
console.log(dim("     (excerpt: checklist + engineering note — every glyph below chosen by a callback)"));
console.log();
const from = log.indexOf("## Pre-flight checklist");
const to = log.indexOf("## Sign-off");
console.log(renderAll(log.slice(from, to)).custom);

await beat();
console.log(rule());
console.log();
console.log(gauge("mission log", `${fmt.int(report.chars)} chars · ${log.split("\n").length} lines`, palette.sky));
console.log(gauge("html pass — headings + autolinks on", fmt.us(report.timings.htmlUs)));
console.log(gauge("ansi pass — built-in terminal styling", fmt.us(report.timings.ansiUs)));
console.log(gauge("custom pass — every element through a JS callback", fmt.us(report.timings.customUs)));

const iterations = 1000;
const t0 = Bun.nanoseconds();
for (let i = 0; i < iterations; i++) Bun.markdown.html(log, { headings: true, autolinks: true });
const totalMs = (Bun.nanoseconds() - t0) / 1e6;
await beat();
console.log(gauge(
  `html sustained — ${fmt.int(iterations)} full renders in ${fmt.ms(totalMs)}`,
  `${fmt.int(iterations / (totalMs / 1000))} renders/sec`,
  palette.flame,
));

console.log();
console.log(dim(prose(
  "Why it matters: markdown-to-anything used to mean an npm parser and a plugin stack. " +
  "Bun.markdown ships GFM in the runtime — html and ansi for free, and render() hands every " +
  "block and inline to your own callbacks, so one document becomes HTML, a terminal " +
  "transcript, or any format you can type, at native-parser speed.",
)));
console.log();
