/**
 * Cargo Hold — six native parsers and a tar crane, no cargo cult npm.
 * The same manifest rides in every dialect Bun 1.4 speaks (JSON5, JSONC,
 * JSONL, XML, YAML, TOML); Bun.deepEquals certifies the four data dialects
 * agree on the cargo, then Bun.Archive packs, lists, and extracts the lot
 * and we verify every byte came home.
 */
import type { CargoReport, DeckStatus } from "../types.ts";
import { join } from "node:path";

const CONTENT_DIR = join(import.meta.dir, "../content/cargo");
const CARGO_DIR = ".flight-data/cargo";
const ARCHIVE_NAME = "cargo.tar.gz";

interface Bay {
  name: string;
  file: string;
  parse: (text: string) => unknown;
  /** carries the core manifest object, so it joins the deepEquals consensus */
  core: boolean;
}

const bays: Bay[] = [
  { name: "json5", file: "manifest.json5", parse: t => Bun.JSON5.parse(t), core: true },
  { name: "jsonc", file: "manifest.jsonc", parse: t => Bun.JSONC.parse(t), core: true },
  { name: "jsonl", file: "events.jsonl", parse: t => Bun.JSONL.parse(t), core: false },
  { name: "xml", file: "manifest.xml", parse: t => Bun.XML.parse(t), core: false },
  { name: "yaml", file: "manifest.yaml", parse: t => Bun.YAML.parse(t), core: true },
  { name: "toml", file: "manifest.toml", parse: t => Bun.TOML.parse(t), core: true },
];

export function cargoStatus(): DeckStatus {
  const missing = bays
    .filter(bay => typeof (Bun as any)[bay.name.toUpperCase()]?.parse !== "function")
    .map(bay => bay.name);
  if (typeof Bun.Archive !== "function") missing.push("Archive");
  if (missing.length) {
    return {
      online: false,
      note: `parser bays dark: Bun.${missing.join(", Bun.")} not aboard — this hold needs Bun ≥ 1.4`,
    };
  }
  return { online: true, note: "six parser bays humming, tar crane armed" };
}

function preview(value: unknown): string {
  const flat = Bun.inspect(value, { depth: 1 }).replace(/\s+/g, " ");
  return flat.length > 80 ? `${flat.slice(0, 79)}…` : flat;
}

/**
 * Parse all six dialects (timed in µs), certify consensus, then run the
 * full Bun.Archive roundtrip: pack → write → read back → extract → compare.
 * A dialect's `ok` means it parsed *and*, for the four core dialects,
 * agreed with the others under Bun.deepEquals(strict).
 */
export async function inspect(): Promise<CargoReport> {
  const sources = new Map<string, string>();
  for (const bay of bays) sources.set(bay.file, await Bun.file(join(CONTENT_DIR, bay.file)).text());

  const parsed = new Map<string, unknown>();
  const dialects = bays.map(bay => {
    const t0 = Bun.nanoseconds();
    try {
      const value = bay.parse(sources.get(bay.file)!);
      const parseUs = (Bun.nanoseconds() - t0) / 1e3;
      parsed.set(bay.name, value);
      return { name: bay.name, sample: preview(value), parseUs, ok: true };
    } catch (err) {
      const parseUs = (Bun.nanoseconds() - t0) / 1e3;
      return { name: bay.name, sample: `parse refused: ${(err as Error).message}`, parseUs, ok: false };
    }
  });

  // The four data dialects must describe the identical cargo. First one
  // parsed becomes the witness; any strict deepEquals mismatch is flagged.
  const [witness, ...others] = bays.filter(b => b.core && parsed.has(b.name)).map(b => b.name);
  for (const name of others) {
    if (Bun.deepEquals(parsed.get(witness!), parsed.get(name), true)) continue;
    const dialect = dialects.find(d => d.name === name)!;
    dialect.ok = false;
    dialect.sample += ` — disagrees with ${witness} on the cargo`;
  }

  const tarPath = join(CARGO_DIR, ARCHIVE_NAME);
  const p0 = Bun.nanoseconds();
  const packed = new Bun.Archive(Object.fromEntries(sources), { compress: "gzip" });
  await Bun.write(tarPath, packed);
  const packMs = (Bun.nanoseconds() - p0) / 1e6;

  // Read the tarball back cold from disk — gzip is auto-detected.
  const hold = new Bun.Archive(await Bun.file(tarPath).bytes());
  const files = [...(await hold.files())]
    .map(([path, file]) => ({ path, size: file.size }))
    .sort((a, b) => a.path.localeCompare(b.path));

  const extractDir = join(CARGO_DIR, "extracted");
  const e0 = Bun.nanoseconds();
  await hold.extract(extractDir);
  const extractMs = (Bun.nanoseconds() - e0) / 1e6;

  let roundtripOk = files.length === bays.length;
  for (const [file, text] of sources) {
    const back = await Bun.file(join(extractDir, file)).bytes();
    if (!Bun.deepEquals(back, new TextEncoder().encode(text), true)) roundtripOk = false;
  }

  return {
    dialects,
    archive: {
      name: ARCHIVE_NAME,
      bytes: Bun.file(tarPath).size,
      format: "tar + gzip",
      files,
      packMs,
      extractMs,
      roundtripOk,
    },
  };
}
