/**
 * The pantry: paints `assets/nebula.png` — a cinnamon-and-strawberry nebula
 * with a sunrise coming over the bottom of the frame — using nothing but math
 * and a hand-rolled PNG encoder (IHDR/IDAT/IEND, Bun.deflateSync, own CRC-32).
 * Seeded, so every clone of the ship bakes the identical sky.
 */

const WIDTH = 1024;
const HEIGHT = 640;
const SEED = 0x140;
export const NEBULA_PATH = new URL("./nebula.png", import.meta.url).pathname;

// ── deterministic noise ─────────────────────────────────────────────────────

function hash2(x: number, y: number, seed: number): number {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263)) ^ seed;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const fade = (t: number) => t * t * (3 - 2 * t);

function valueNoise(x: number, y: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const tx = fade(x - xi);
  const ty = fade(y - yi);
  const top = lerp(hash2(xi, yi, seed), hash2(xi + 1, yi, seed), tx);
  const bot = lerp(hash2(xi, yi + 1, seed), hash2(xi + 1, yi + 1, seed), tx);
  return lerp(top, bot, ty);
}

/** Fractal Brownian motion: stacked octaves of value noise, normalized to 0..1. */
function fbm(x: number, y: number, seed: number, octaves: number): number {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * valueNoise(x, y, seed + o * 0x9e37);
    norm += amp;
    x = x * 2.03 + 17.1;
    y = y * 2.03 + 9.7;
    amp *= 0.5;
  }
  return sum / norm;
}

const smoothstep = (lo: number, hi: number, v: number) => {
  const t = Math.min(1, Math.max(0, (v - lo) / (hi - lo)));
  return t * t * (3 - 2 * t);
};

// ── the painting ────────────────────────────────────────────────────────────

// theme.ts palette, decomposed to channels
const CARAMEL = [217, 119, 6] as const;
const STRAWBERRY = [249, 168, 212] as const;
const FLAME = [251, 146, 60] as const;
const STARLIGHT = [253, 230, 138] as const;
const SKY = [125, 211, 252] as const;

function paintNebula(): Uint8Array {
  const px = new Float64Array(WIDTH * HEIGHT * 3);
  const sunX = WIDTH * 0.72;
  const sunY = HEIGHT * 1.09; // the disc rides below the frame; only its glow rises
  const sunR = HEIGHT * 0.16;

  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      const i = (y * WIDTH + x) * 3;
      const v = y / HEIGHT;

      // deep space: indigo, warming faintly toward the sunrise
      let r = 7 + 9 * v;
      let g = 5 + 5 * v;
      let b = 16 + 15 * v;

      // domain-warped clouds — the warp is what makes them billow
      const warp = fbm(x * 0.004, y * 0.004, SEED ^ 0x51ee, 3);
      const wx = x * 0.0058 + warp * 1.9;
      const wy = y * 0.0058 + warp * 1.9;
      const cinnamon = smoothstep(0.44, 0.82, fbm(wx, wy, SEED ^ 0xcafe, 5));
      const berry = smoothstep(0.5, 0.88, fbm(wx * 1.31 + 41, wy * 1.31 + 8, SEED ^ 0xf00d, 5));
      const wisp = smoothstep(0.55, 0.95, fbm(wx * 2.2 + 90, wy * 2.2 + 55, SEED ^ 0xb1e, 4));

      r += CARAMEL[0] * cinnamon * 0.5 + STRAWBERRY[0] * berry * 0.42 + SKY[0] * wisp * 0.1;
      g += CARAMEL[1] * cinnamon * 0.5 + STRAWBERRY[1] * berry * 0.42 + SKY[1] * wisp * 0.1;
      b += CARAMEL[2] * cinnamon * 0.5 + STRAWBERRY[2] * berry * 0.42 + SKY[2] * wisp * 0.1;

      // the rising sun: a hot rim where the disc crests, a long soft corona
      const d = Math.hypot(x - sunX, y - sunY);
      const corona = Math.exp(-Math.max(0, d - sunR) / (sunR * 1.35));
      const rim = Math.exp(-Math.max(0, d - sunR) / (sunR * 0.22));
      const core = d < sunR ? 1 : 0;
      r += FLAME[0] * corona * 0.85 + STARLIGHT[0] * rim * 0.7 + 255 * core;
      g += FLAME[1] * corona * 0.85 + STARLIGHT[1] * rim * 0.7 + 245 * core;
      b += FLAME[2] * corona * 0.85 + STARLIGHT[2] * rim * 0.7 + 205 * core;

      px[i] = r;
      px[i + 1] = g;
      px[i + 2] = b;
    }
  }

  scatterStars(px);

  const out = new Uint8Array(WIDTH * HEIGHT * 3);
  for (let i = 0; i < px.length; i++) out[i] = Math.min(255, Math.round(px[i]));
  return out;
}

function scatterStars(px: Float64Array): void {
  for (let s = 0; s < 460; s++) {
    const x = Math.floor(hash2(s, 1, SEED ^ 0x57a2) * WIDTH);
    const y = Math.floor(hash2(s, 2, SEED ^ 0x57a2) * HEIGHT);
    const mag = hash2(s, 3, SEED ^ 0x57a2) ** 2.4; // mostly faint, a few brilliant
    const warmth = hash2(s, 4, SEED ^ 0x57a2);
    const tint = warmth < 0.3 ? STARLIGHT : warmth < 0.5 ? SKY : ([236, 240, 248] as const);
    const reach = 1 + Math.round(mag * 3);
    for (let dy = -reach; dy <= reach; dy++) {
      for (let dx = -reach; dx <= reach; dx++) {
        const tx = x + dx;
        const ty = y + dy;
        if (tx < 0 || tx >= WIDTH || ty < 0 || ty >= HEIGHT) continue;
        // a four-pointed twinkle: bright core, rays along the axes
        const axial = dx === 0 || dy === 0 ? 1 : 0.15;
        const glow = mag * 255 * axial * Math.exp(-(dx * dx + dy * dy) / (1 + mag * 4));
        const i = (ty * WIDTH + tx) * 3;
        px[i] += (tint[0] / 255) * glow;
        px[i + 1] += (tint[1] / 255) * glow;
        px[i + 2] += (tint[2] / 255) * glow;
      }
    }
  }
}

// ── the encoder: a PNG from first principles ────────────────────────────────

const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function adler32(bytes: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (const byte of bytes) {
    a = (a + byte) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set([...type].map(c => c.charCodeAt(0)), 4);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

function encodePng(rgb: Uint8Array): Uint8Array {
  const ihdr = new Uint8Array(13);
  const iv = new DataView(ihdr.buffer);
  iv.setUint32(0, WIDTH);
  iv.setUint32(4, HEIGHT);
  ihdr.set([8, 2, 0, 0, 0], 8); // 8-bit, truecolor RGB

  // Sub-filter every scanline: gradients become tiny deltas, deflate feasts
  const stride = WIDTH * 3;
  const raw = new Uint8Array((stride + 1) * HEIGHT);
  for (let y = 0; y < HEIGHT; y++) {
    const row = y * (stride + 1);
    raw[row] = 1;
    for (let i = 0; i < stride; i++) {
      const src = y * stride + i;
      raw[row + 1 + i] = (rgb[src] - (i >= 3 ? rgb[src - 3] : 0)) & 0xff;
    }
  }

  // Bun.deflateSync emits raw DEFLATE; the zlib envelope PNG wants is ours to add
  const deflated = Bun.deflateSync(raw, { level: 9 });
  const zlib = new Uint8Array(deflated.length + 6);
  zlib.set([0x78, 0xda]);
  zlib.set(deflated, 2);
  new DataView(zlib.buffer).setUint32(zlib.length - 4, adler32(raw));

  const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const parts = [signature, chunk("IHDR", ihdr), chunk("IDAT", zlib), chunk("IEND", new Uint8Array(0))];
  const png = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    png.set(part, offset);
    offset += part.length;
  }
  return png;
}

/** Paint the nebula if it isn't in the pantry yet; return its path either way. */
export async function ensureNebula(): Promise<string> {
  if (await Bun.file(NEBULA_PATH).exists()) return NEBULA_PATH;
  await Bun.write(NEBULA_PATH, encodePng(paintNebula()));
  return NEBULA_PATH;
}

if (import.meta.main) {
  const t0 = Bun.nanoseconds();
  const existed = await Bun.file(NEBULA_PATH).exists();
  const path = await ensureNebula();
  const ms = (Bun.nanoseconds() - t0) / 1e6;
  const size = Bun.file(path).size;
  console.log(
    existed
      ? `nebula already hangs in the pantry — ${path} (${(size / 1024).toFixed(1)} KB)`
      : `painted ${WIDTH}×${HEIGHT} nebula in ${ms.toFixed(0)} ms — ${path} (${(size / 1024).toFixed(1)} KB)`,
  );
}
