/**
 * The single source of truth for every shape that crosses a boundary —
 * server ⇄ UI, systems ⇄ server, demos ⇄ humans.
 *
 * Runtime artifacts (baked images, screenshots, archives) are written under
 * `.flight-data/` at the repo root; it is gitignored and safe to delete.
 */

/** One heartbeat of ship telemetry, published on the `telemetry` topic every 500 ms. */
export interface TelemetryFrame {
  type: "telemetry";
  /** ms since epoch */
  t: number;
  /** seconds since liftoff */
  uptime: number;
  /** resident set size, bytes */
  rss: number;
  /** JS heap used, bytes */
  heapUsed: number;
  /** event-loop lag sampled over the last interval, ms */
  loopLagMs: number;
  /** process CPU usage over the last interval, 0–1 per core (may exceed 1) */
  cpu: number;
  /** requests served since liftoff */
  requestsServed: number;
  /** currently in-flight requests (server.pendingRequests) */
  pendingRequests: number;
  /** open WebSocket connections (server.pendingWebSockets) */
  pendingWebSockets: number;
}

export interface StatusReport {
  ship: "Oven-1";
  mission: "ORBITAL BAKERY";
  bun: { version: string; revision: string };
  pid: number;
  startedAt: number;
  /** capability probes, so the UI can dim decks that can't run here */
  decks: {
    photonOven: DeckStatus;
    observationDeck: DeckStatus;
    commsBay: DeckStatus;
    chronometer: DeckStatus;
    engineRoom: DeckStatus;
    cargoHold: DeckStatus;
    reactor: DeckStatus;
  };
}

export interface DeckStatus {
  online: boolean;
  /** short human note, e.g. "Chrome found: /usr/bin/chromium" or a friendly reason it's offline */
  note: string;
}

/** Photon Oven — one full Bun.Image pipeline run over the procedurally-baked nebula. */
export interface BakeReport {
  source: { name: string; width: number; height: number; bytes: number; format: string };
  /** each output step, in pipeline order */
  outputs: BakedAsset[];
  /** ThumbHash-style low-quality placeholder as a data: URL (inline-able, ~0.5 KB) */
  placeholder: string;
  totalMs: number;
}

export interface BakedAsset {
  /** asset name, fetchable at /api/oven/asset/:name */
  name: string;
  op: string; // e.g. "resize 512 → webp q80"
  format: string;
  width: number;
  height: number;
  bytes: number;
  ms: number;
  /** set when this output demonstrates a documented fallback (e.g. AVIF → WebP on Linux) */
  fallback?: string;
}

/** Observation Deck — the ship photographs its own dashboard. */
export interface SnapshotReport {
  ok: boolean;
  /** why the deck is idle, when ok=false (e.g. no Chrome-family browser found) */
  reason?: string;
  url?: string;
  title?: string;
  backend?: string;
  /** fetchable at /api/observation/asset/:name */
  asset?: { name: string; bytes: number; width: number; height: number };
  timings?: { spawnMs: number; navigateMs: number; screenshotMs: number; totalMs: number };
  /** a fact read from inside the page via view.evaluate() */
  evaluated?: Record<string, unknown>;
}

/** Comms Bay — one markdown source, three renderers. */
export interface CommsReport {
  html: string;
  ansi: string;
  /** custom Bun.markdown.render() output (mission-log flavored) */
  custom: string;
  chars: number;
  /** microseconds per renderer */
  timings: { htmlUs: number; ansiUs: number; customUs: number };
}

export interface CronReport {
  expr: string;
  valid: boolean;
  error?: string;
  /** next firing times, ISO strings, local zone */
  next: string[];
  /** live in-process jobs registered by the Chronometer deck */
  jobs: { name: string; expr: string; runs: number; lastRun?: string }[];
}

/** Cargo Hold — the same manifest in six dialects + a tar roundtrip. */
export interface CargoReport {
  /** per-dialect parse of the identical manifest */
  dialects: { name: string; sample: string; parseUs: number; ok: boolean }[];
  archive: {
    name: string;
    bytes: number;
    format: string;
    files: { path: string; size: number }[];
    packMs: number;
    extractMs: number;
    roundtripOk: boolean;
  };
}

/** Reactor — a short, honest, self-inflicted HTTP hurricane. */
export interface BurstReport {
  durationMs: number;
  concurrency: number;
  requests: number;
  reqPerSec: number;
  latency: { p50Ms: number; p99Ms: number; maxMs: number };
  bytesMoved: number;
}

/** Reactor — cold-start drag race, measured right here, right now. */
export interface StartupRaceReport {
  runs: number;
  lanes: {
    runtime: string; // "bun 1.4.0" | "node v22.x"
    cmd: string;
    /** best-of-N wall-clock ms to run an empty program */
    bestMs: number;
    medianMs: number;
    available: boolean;
  }[];
  note: string;
}

/**
 * Engine Room WebSocket envelopes (shared /ws socket with telemetry).
 * `engine/data.data` is base64-encoded raw PTY bytes (UI decodes, then renders ANSI).
 * `engine/write.data` is plain UTF-8 keyboard input.
 */
export type EngineClientMsg =
  | { type: "engine/start" }
  | { type: "engine/write"; data: string }
  | { type: "engine/resize"; cols: number; rows: number };

export type EngineServerMsg =
  | { type: "engine/data"; data: string }
  | { type: "engine/exit"; code: number | null };

export type WsServerMsg = TelemetryFrame | EngineServerMsg;
