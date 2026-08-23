/**
 * Photon Oven — the ship's Bun.Image deck. One bake() run pushes the nebula
 * through the whole native pipeline: metadata, two resampling kernels, a
 * saturation glaze, four encoders, and a ThumbHash placeholder. Every number
 * in the report was measured during that run; every transform executed off
 * the JavaScript thread.
 */
import type { BakedAsset, BakeReport, DeckStatus } from "../types.ts";
import { ensureNebula } from "../../assets/generate-nebula.ts";

export const OVEN_DIR = ".flight-data/oven";

const AVIF_CAPABLE = process.platform !== "linux";

export function ovenStatus(): DeckStatus {
  if (typeof Bun.Image !== "function") {
    return { online: false, note: "Bun.Image not found — this hull predates the photon oven (needs Bun ≥ 1.4)" };
  }
  return {
    online: true,
    note: AVIF_CAPABLE
      ? "oven hot — jpeg/png/webp + system codecs for avif/heic"
      : "oven hot — jpeg/png/webp everywhere; avif/heic sit out on Linux, WebP covers the shift",
  };
}

const ms = (fromNs: number) => (Bun.nanoseconds() - fromNs) / 1e6;

async function fire(
  outputs: BakedAsset[],
  name: string,
  op: string,
  pipeline: { write(path: string): Promise<number>; width: number; height: number },
  format: string,
  fallback?: string,
): Promise<BakedAsset> {
  const t0 = Bun.nanoseconds();
  const bytes = await pipeline.write(`${OVEN_DIR}/${name}`);
  const asset: BakedAsset = {
    name,
    op,
    format,
    width: pipeline.width,
    height: pipeline.height,
    bytes,
    ms: ms(t0),
    ...(fallback ? { fallback } : {}),
  };
  outputs.push(asset);
  return asset;
}

export async function bake(width = 512): Promise<BakeReport> {
  const t0 = Bun.nanoseconds();
  const sourcePath = await ensureNebula();
  const sourceBytes = await Bun.file(sourcePath).bytes();
  const oven = (): Bun.Image => new Bun.Image(sourceBytes);
  const outputs: BakedAsset[] = [];

  const tMeta = Bun.nanoseconds();
  const meta = await oven().metadata();
  const metadataMs = ms(tMeta);
  const w = Math.max(16, Math.min(Math.floor(width), meta.width));

  // Header-only read: dimensions and format without decoding a single pixel.
  // The untouched source goes into the rack too, so the UI can serve it by name.
  await Bun.write(`${OVEN_DIR}/nebula.png`, sourceBytes);
  outputs.push({
    name: "nebula.png",
    op: "metadata() — header only, zero pixels decoded",
    format: meta.format,
    width: meta.width,
    height: meta.height,
    bytes: sourceBytes.byteLength,
    ms: metadataMs,
  });

  const resized = await fire(
    outputs,
    `nebula-${w}.png`,
    `resize ${w} · lanczos3, fit inside → png`,
    oven().resize(w, w, { fit: "inside" }).png(),
    "png",
  );

  await fire(
    outputs,
    `nebula-${w}-mks2013.png`,
    `resize ${w} · mks2013, Instagram's kernel → png`,
    oven().resize(w, w, { fit: "inside", filter: "mks2013" }).png(),
    "png",
  );

  await fire(
    outputs,
    `nebula-${w}-glazed.webp`,
    "modulate sat ×1.5 — strawberry glaze → webp q80",
    oven().resize(w, w, { fit: "inside" }).modulate({ saturation: 1.5 }).webp({ quality: 80 }),
    "webp",
  );

  await fire(
    outputs,
    `nebula-${w}.webp`,
    "encode webp q80",
    oven().resize(w, w, { fit: "inside" }).webp({ quality: 80 }),
    "webp",
  );

  await fire(
    outputs,
    `nebula-${w}.jpg`,
    "encode jpeg q85 progressive, coarse-to-fine",
    oven().resize(w, w, { fit: "inside" }).jpeg({ quality: 85, progressive: true }),
    "jpeg",
  );

  const indexed = await fire(
    outputs,
    `nebula-${w}-palette.png`,
    "png palette:64 + dither",
    oven().resize(w, w, { fit: "inside" }).png({ palette: true, colors: 64, dither: true }),
    "png",
  );
  indexed.op += ` — ${(resized.bytes / indexed.bytes).toFixed(1)}× vs truecolor png`;

  // AVIF needs an OS AV1 encoder; where there isn't one, the documented
  // ERR_IMAGE_FORMAT_UNSUPPORTED branch drops to WebP — we demo the fallback itself.
  try {
    await fire(
      outputs,
      `nebula-${w}.avif`,
      "encode avif q60 via the system AV1 encoder",
      oven().resize(w, w, { fit: "inside" }).avif({ quality: 60 }),
      "avif",
    );
  } catch (err) {
    if ((err as { code?: string }).code !== "ERR_IMAGE_FORMAT_UNSUPPORTED") throw err;
    await fire(
      outputs,
      `nebula-${w}-avif-fallback.webp`,
      "avif q60 → ERR_IMAGE_FORMAT_UNSUPPORTED → webp",
      oven().resize(w, w, { fit: "inside" }).webp({ quality: 80 }),
      "webp",
      "AVIF encode rides the OS codec (macOS 13+ on M3+, Windows with the AV1 extension); " +
        `this hull runs ${process.platform}, so the oven took the documented exit to WebP.`,
    );
  }

  const placeholder = await oven().placeholder();

  return {
    source: {
      name: "nebula.png",
      width: meta.width,
      height: meta.height,
      bytes: sourceBytes.byteLength,
      format: meta.format,
    },
    outputs,
    placeholder,
    totalMs: ms(t0),
  };
}
