# FLIGHTPLAN — Orbital Bakery, Mission Control for Bun 1.4

> The design contract for this repository. Every module, route, and demo listed here
> exists, runs, and is tested. If you change a contract, change it here first.

## The narrative

The **Oven‑1** is a bakery in orbit: a zero-dependency spacecraft whose mission is to
deliver **1.4 million fresh buns** to the outer colonies. This repository is her flight
deck. Bun 1.4 — the first Bun written in Rust — is the reactor.

One command lifts off:

```sh
bun start        # Mission Control on http://localhost:1414
```

Everything the ship does is a Bun 1.4 feature, doing real work, measured live.
No frameworks. No runtime dependencies. No build step. Just Bun.

## Ship systems → Bun 1.4 features

| Deck                 | Bun 1.4 feature                                       | Module                            | Standalone demo               |
| -------------------- | ----------------------------------------------------- | --------------------------------- | ----------------------------- |
| Flight Deck          | `Bun.serve` + HTML imports + WebSocket pub/sub        | `src/server.ts`, `src/ui/*`       | `bun start`                   |
| Reactor (telemetry)  | mimalloc-era memory + throughput, startup race        | `src/telemetry.ts`, `src/systems/reactor.ts` | `demos/07-reactor.ts`  |
| Photon Oven          | `Bun.Image` — resize, modulate, formats, placeholder  | `src/systems/photon-oven.ts`      | `demos/01-photon-oven.ts`     |
| Observation Deck     | `Bun.WebView` — headless browser in the runtime       | `src/systems/observation-deck.ts` | `demos/02-observation-deck.ts`|
| Comms Bay            | `Bun.markdown` — html / ansi / custom renderers       | `src/systems/comms.ts`            | `demos/03-comms.ts`           |
| Chronometer          | `Bun.cron` + `Bun.cron.parse`                         | `src/systems/chronometer.ts`      | `demos/04-chronometer.ts`     |
| Engine Room          | `Bun.Terminal` — a real PTY, streamed to the browser  | `src/systems/engine-room.ts`      | `demos/05-engine-room.ts`     |
| Cargo Hold           | `Bun.Archive` + JSON5/JSONC/JSONL/XML/YAML/TOML       | `src/systems/cargo-hold.ts`       | `demos/06-cargo-hold.ts`      |
| Hyperdrive           | `bun run --parallel`, `bun test --parallel`           | `package.json` scripts            | `demos/08-hyperdrive.ts`      |
| Grand Tour           | all of the above, in sequence, in the terminal        | `scripts/tour.ts`                 | `bun run tour`                |

## Hard rules

1. **Zero runtime dependencies.** `dependencies` stays `{}`. Dev deps: `bun-types` only.
2. **Truthful telemetry.** Numbers shown are measured on this machine, at that moment.
   Release-note claims (e.g. "35% less memory") are quoted as claims, labeled as such,
   never presented as local measurements.
3. **Graceful degradation.** Every platform-dependent feature (WebView without a
   Chrome-family browser, HEIC/AVIF on Linux, clipboard on Linux) fails soft with a
   friendly, specific message — and where the docs define a fallback (e.g.
   `ERR_IMAGE_FORMAT_UNSUPPORTED` → WebP), we demo the fallback itself.
4. **Every demo is self-contained.** `bun demos/NN-name.ts` works from a fresh clone
   with no server running, no flags, no env vars.
5. **Elegant code.** Small modules, expressive names, comments only where the *why*
   is not in the code. The code is part of the show.

## API contract (server ⇄ UI)

Server listens on `PORT` env or **1414**, bound to `HOST` env or **127.0.0.1** —
loopback by default, because `/ws` carries a live Engine Room shell and must never
face an untrusted network. Routes (all JSON unless noted):

| Route                          | Method | Body / params                | Returns |
| ------------------------------ | ------ | ---------------------------- | ------- |
| `/`                            | GET    | —                            | dashboard (HTML import) |
| `/ws`                          | WS     | —                            | telemetry frames (below) + topic messages |
| `/api/status`                  | GET    | —                            | `StatusReport` |
| `/api/oven/bake`               | POST   | `{ width?: number }`         | `BakeReport` |
| `/api/oven/asset/:name`        | GET    | name ∈ generated set         | image bytes (correct Content-Type) |
| `/api/observation/snapshot`    | POST   | `{}`                         | `SnapshotReport` |
| `/api/observation/asset/:name` | GET    | —                            | screenshot bytes |
| `/api/comms/render`            | POST   | `{ markdown: string }`       | `CommsReport` |
| `/api/chronometer/windows`     | GET    | `?expr=<cron>&count=5`       | `CronReport` |
| `/api/cargo/inspect`           | POST   | `{}`                         | `CargoReport` |
| `/api/reactor/burst`           | POST   | `{ durationMs? }` (cap 5000) | `BurstReport` |
| `/api/reactor/startup-race`    | POST   | `{}`                         | `StartupRaceReport` |

WebSocket protocol: server publishes to topic `telemetry` a JSON `TelemetryFrame`
every 500 ms. Engine Room uses the same socket with typed envelopes:
client → `{type:"engine/write", data: string}`, `{type:"engine/start"}`,
`{type:"engine/resize", cols, rows}`; server → `{type:"engine/data", data: string}`,
`{type:"engine/exit", code}`. All other frames: `{type:"telemetry", ...TelemetryFrame}`.

All shared shapes live in `src/types.ts` — the single source of truth.

## File ownership (build phase)

Each builder owns its files exclusively; cross-module needs go through
`src/types.ts` (frozen) and `src/lib/theme.ts` (frozen).

## Module contracts (frozen export signatures)

`src/server.ts` imports exactly these; systems import types from `../types.ts`:

```ts
// src/systems/photon-oven.ts
export const OVEN_DIR: string;                       // ".flight-data/oven"
export function ovenStatus(): DeckStatus;
export async function bake(width?: number): Promise<BakeReport>;

// src/systems/observation-deck.ts
export const OBS_DIR: string;                        // ".flight-data/observation"
export function observationStatus(): DeckStatus;     // probes for a Chrome-family browser
export async function snapshot(targetUrl: string): Promise<SnapshotReport>;

// src/systems/comms.ts
export function commsStatus(): DeckStatus;
export function missionLog(): string;                // the ship's log, markdown source
export function renderAll(markdown: string): CommsReport;

// src/systems/chronometer.ts
export function chronometerStatus(): DeckStatus;
export function windows(expr: string, count?: number): CronReport;   // also lists live jobs
export function startShipJobs(onPulse: (job: string) => void): void; // registers Bun.cron jobs

// src/systems/engine-room.ts
export function engineStatus(): DeckStatus;
export function createEngineSession(
  send: (msg: EngineServerMsg) => void,
): { handle(msg: EngineClientMsg): void; dispose(): void };

// src/systems/cargo-hold.ts
export function cargoStatus(): DeckStatus;
export async function inspect(): Promise<CargoReport>;

// src/systems/reactor.ts
export function reactorStatus(): DeckStatus;
export async function burst(baseUrl: string, durationMs: number): Promise<BurstReport>;
export async function startupRace(): Promise<StartupRaceReport>;

// src/telemetry.ts
export function startTelemetry(opts: {
  getServerCounts: () => { pendingRequests: number; pendingWebSockets: number };
  getRequestsServed: () => number;
  publish: (frame: TelemetryFrame) => void;          // server publishes to the ws topic
  intervalMs?: number;                               // default 500
}): () => void;                                      // returns stop()
```

Environment: `BUN_CHROME_PATH` may point at a Chromium binary (Bun.WebView also
searches `$PATH` and standard locations itself). `PORT` overrides 1414; `HOST`
overrides the loopback-only bind (a deliberate act — see the API contract note).

## Verification bar (QC phase)

- `bun test` green (and `bun test --parallel` green).
- Every `demos/*.ts` exits 0 in ≤ 60 s in a fresh container, with and without Chrome.
- `bun start` boots; `/api/status` 200; dashboard renders; a `Bun.WebView` QC probe
  screenshots the live dashboard and asserts every deck panel is present.
- Fresh-clone quickstart from the README works verbatim.
