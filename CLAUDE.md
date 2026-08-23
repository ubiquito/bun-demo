# CLAUDE.md — crew notes for the Oven-1

Orbital Bakery is a zero-dependency showcase of Bun 1.4 (`engines: bun >=1.4.0`).
A `Bun.serve` dashboard ("Mission Control", `bun start`, port 1414) plus standalone
terminal demos, wrapped in a spaceship-bakery narrative. The code is part of the show.

## The contract

**`docs/FLIGHTPLAN.md` is the design contract.** Every module, route, export signature,
and demo listed there exists, runs, and is tested. Changing a behavior means changing
the FLIGHTPLAN first, then the code. `src/types.ts` (all shared shapes) and
`src/lib/theme.ts` (all terminal styling: `deck()`, `gauge()`, `ok()/warn()/fail()`,
`fmt`, palette) are frozen — build on them, don't edit them.

## Hard rules

1. **Zero runtime dependencies.** `dependencies` stays `{}`; dev deps: `bun-types` only.
2. **Truthful numbers.** Anything printed as a measurement was measured on this machine,
   during that run (`Bun.nanoseconds()` around real work). Release-note figures are
   quoted as claims and labeled as such — never passed off as local.
3. **Graceful degradation.** Platform-dependent features (no Chrome for `Bun.WebView`,
   no AVIF on Linux, no `openssl` for warp, no Kitty terminal for postcards) fail soft
   with a friendly, *specific* message, and exit 0. Only a pre-1.4 bun grounds anything.
4. **Self-contained demos.** Every `demos/NN-*.ts` exits 0 from a fresh clone in ≤60 s —
   no server running, no flags, no env vars required.
5. **Ship's voice.** Witty, in-theme, never cringe; precision is the charm.

## Repo shape

- `src/server.ts` — Mission Control: routes, WebSocket telemetry, HTML import of `src/ui/`
- `src/systems/*.ts` — one module per deck (oven, observation, comms, chronometer,
  engine-room, cargo-hold, reactor); export signatures are frozen in the FLIGHTPLAN
- `src/lib/` — `theme.ts` (frozen), `postcard.ts` (terminal graphics carriers)
- `src/content/cargo/` — human-editable manifests, embedded into builds as text imports
- `demos/01…08` — standalone deck demos; `tests/` — the suite
- `scripts/` — `tour.ts`, plus the second service: `doctor.ts`, `pack.ts` (compile to
  one binary), `bridge.ts` (node:repl), `warp.ts` (HTTP/3)
- `assets/generate-nebula.ts` — deterministic source image (seeded; don't break the sha)

## Verify (before calling anything done)

```sh
bun run doctor   # <1 s host physical; advisory except the bun-version check
bun test         # must stay green (also try --parallel)
bun run tour     # the whole show end-to-end in the terminal
```

Run what you touched: the matching `demos/NN-*.ts`, and `bun start` + a route probe for
server changes. Quote only numbers your own run printed.

## Runtime artifacts

Everything generated at runtime lands under `.flight-data/` only (gitignored, safe to
delete): oven bakes, screenshots, cargo tars, warp certs, bridge history, the compiled
`shipwright/oven-1` binary. Never write runtime output anywhere else in the tree.

Notes: server binds `127.0.0.1` by default because `/ws` carries a live PTY shell —
keep it that way. Docs syncs: README mirrors the FLIGHTPLAN's tables; keep claims
attributed, and don't spoil the dashboard's classic incantation in print.
