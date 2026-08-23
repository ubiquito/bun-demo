/**
 * Photon Oven, standalone: paint the nebula if the pantry is bare, then run
 * the full Bun.Image pipeline at 512px and read every dial out loud.
 */
import { deck, dim, fmt, gauge, ok, palette, prose, warn } from "../src/lib/theme.ts";
import { ensureNebula, NEBULA_PATH } from "../assets/generate-nebula.ts";
import { bake, OVEN_DIR } from "../src/systems/photon-oven.ts";

const beat = () => Bun.sleep(90);

console.log(deck("🥐", "Photon Oven", "Bun.Image — decode · resize · glaze · re-encode, all native, all off-thread"));

const hadNebula = await Bun.file(NEBULA_PATH).exists();
if (!hadNebula) {
  const t0 = Bun.nanoseconds();
  await ensureNebula();
  const paintMs = (Bun.nanoseconds() - t0) / 1e6;
  console.log(ok(`pantry was bare — painted a fresh 1024×640 nebula in ${fmt.ms(paintMs)}`));
} else {
  console.log(ok("nebula found in the pantry — no repainting needed"));
}

const report = await bake(512);
const { source } = report;
console.log(ok(`loaded ${source.name} — ${source.width}×${source.height} ${source.format}, ${fmt.bytes(source.bytes)}`));
console.log();

for (const asset of report.outputs) {
  await beat();
  const color = asset.fallback ? palette.star : palette.mint;
  console.log(gauge(asset.op, `${fmt.bytes(asset.bytes)} · ${fmt.ms(asset.ms)}`, color));
  if (asset.fallback) {
    console.log(warn("documented fallback engaged:"));
    console.log(dim(prose(asset.fallback, 4)));
  }
}

await beat();
const squeeze = source.bytes / report.placeholder.length;
console.log(gauge("placeholder() — ThumbHash LQIP data URL", `${fmt.bytes(report.placeholder.length)} inline`, palette.glow));
console.log(dim(prose(`${report.placeholder.slice(0, 64)}… — the whole preview, ${squeeze.toFixed(0)}× lighter than the source, ready for an <img src> before the real bytes arrive.`, 4)));

await beat();
const baked = report.outputs.filter(a => a.name !== source.name);
const trayBytes = baked.reduce((n, a) => n + a.bytes, 0);
console.log();
console.log(gauge(`full bake — one source, ${baked.length} trays`, `${fmt.bytes(trayBytes)} · ${fmt.ms(report.totalMs)}`, palette.flame));
console.log(ok(`tray racked under ${OVEN_DIR}/`));
console.log();
console.log(dim(prose(
  "Why it matters: this is Sharp-shaped image work with zero npm installs and no native addon " +
  "build step. Every decode, resample, and encode above ran off the JavaScript thread — " +
  "the event loop stayed free to fly the ship while the oven did the baking.",
)));
console.log();
