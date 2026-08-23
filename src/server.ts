/**
 * Flight Deck — the one process that is the whole ship. Bun.serve carries the
 * dashboard (an HTML import, bundled on the fly), every deck's JSON API, and
 * a single WebSocket that streams telemetry out and engine keystrokes in.
 * No framework aboard; the runtime is the framework.
 */
import dashboard from "./ui/index.html";
import type { EngineClientMsg, StatusReport } from "./types.ts";
import { bold, deck, dim, emblemBanner, ok, paint, palette, warn } from "./lib/theme.ts";
import { bake, OVEN_DIR, ovenStatus } from "./systems/photon-oven.ts";
import { OBS_DIR, observationStatus, snapshot } from "./systems/observation-deck.ts";
import { commsStatus, renderAll } from "./systems/comms.ts";
import { chronometerStatus, startShipJobs, windows } from "./systems/chronometer.ts";
import { createEngineSession, engineStatus } from "./systems/engine-room.ts";
import { cargoStatus, inspect } from "./systems/cargo-hold.ts";
import { burst, reactorStatus, startupRace } from "./systems/reactor.ts";
import { startTelemetry } from "./telemetry.ts";

const PORT = Number(process.env.PORT) || 1414;
// The Engine Room hands every /ws passenger a real shell, so the flight deck
// berths on loopback. Opening the outer airlock (HOST=0.0.0.0) is a deliberate
// act — only on a network you'd trust with your own terminal.
const HOSTNAME = process.env.HOST || "127.0.0.1";
const startedAt = Date.now();
let requestsServed = 0;

type EngineSession = ReturnType<typeof createEngineSession>;
type SocketData = { session: EngineSession | null };

// Only names the decks actually mint may leave the ship — no paths, no traversal.
const OVEN_NAMES = /^nebula(?:-\d{1,4}(?:-(?:mks2013|glazed|palette|avif-fallback))?)?\.(?:png|webp|jpg|avif)$/;
const OBS_NAMES = /^snapshot-\d{10,16}-\d{1,6}\.png$/;
const IMAGE_TYPES: Record<string, string> = {
  png: "image/png",
  webp: "image/webp",
  jpg: "image/jpeg",
  avif: "image/avif",
};

function shipStatus(): StatusReport {
  return {
    ship: "Oven-1",
    mission: "ORBITAL BAKERY",
    bun: { version: Bun.version, revision: Bun.revision },
    pid: process.pid,
    startedAt,
    decks: {
      photonOven: ovenStatus(),
      observationDeck: observationStatus(),
      commsBay: commsStatus(),
      chronometer: chronometerStatus(),
      engineRoom: engineStatus(),
      cargoHold: cargoStatus(),
      reactor: reactorStatus(),
    },
  };
}

/** Count the request, run the handler, and keep failures on-board as JSON. */
function guard<R extends { params: Record<string, string> } & Request>(
  handler: (req: R, server: Bun.Server<SocketData>) => Response | undefined | Promise<Response | undefined>,
) {
  return async (req: R, server: Bun.Server<SocketData>): Promise<Response | undefined> => {
    requestsServed++;
    try {
      return await handler(req, server);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return Response.json({ error: `deck fault — ${message}` }, { status: 500 });
    }
  };
}

async function serveAsset(dir: string, name: string, allowlist: RegExp): Promise<Response> {
  if (!allowlist.test(name)) {
    return Response.json({ error: "no asset by that name leaves this ship" }, { status: 404 });
  }
  const file = Bun.file(`${dir}/${name}`);
  if (!(await file.exists())) {
    return Response.json({ error: "asset not made yet — fire that deck first" }, { status: 404 });
  }
  return new Response(file, {
    headers: { "content-type": IMAGE_TYPES[name.split(".").pop()!] ?? "application/octet-stream" },
  });
}

const body = (req: Request) => req.json().catch(() => ({})) as Promise<Record<string, unknown>>;

const server = Bun.serve({
  hostname: HOSTNAME,
  port: PORT,
  routes: {
    "/": dashboard,

    "/ws": guard((req, srv) =>
      srv.upgrade(req, { data: { session: null } })
        ? undefined
        : new Response("this hatch only opens for WebSockets", { status: 426 }),
    ),

    "/api/status": guard(() => Response.json(shipStatus())),

    "/api/oven/bake": {
      POST: guard(async req => {
        const { width } = await body(req);
        return Response.json(await bake(typeof width === "number" ? width : undefined));
      }),
    },
    "/api/oven/asset/:name": guard(req => serveAsset(OVEN_DIR, req.params.name, OVEN_NAMES)),

    "/api/observation/snapshot": {
      POST: guard(async (_req, srv) => Response.json(await snapshot(`http://localhost:${srv.port}`))),
    },
    "/api/observation/asset/:name": guard(req => serveAsset(OBS_DIR, req.params.name, OBS_NAMES)),

    "/api/comms/render": {
      POST: guard(async req => {
        const { markdown } = await body(req);
        if (typeof markdown !== "string") {
          return Response.json({ error: "transmission garbled — send { markdown: string }" }, { status: 400 });
        }
        return Response.json(renderAll(markdown));
      }),
    },

    "/api/chronometer/windows": guard(req => {
      const url = new URL(req.url);
      const expr = url.searchParams.get("expr") ?? "";
      const count = Number(url.searchParams.get("count")) || 5;
      return Response.json(windows(expr, count));
    }),

    "/api/cargo/inspect": {
      POST: guard(async () => Response.json(await inspect())),
    },

    "/api/reactor/burst": {
      POST: guard(async (req, srv) => {
        const { durationMs } = await body(req);
        // The cannon aims at our own /api/status — requestsServed will spike. That's the show.
        return Response.json(
          await burst(`http://localhost:${srv.port}`, typeof durationMs === "number" ? durationMs : 2000),
        );
      }),
    },
    "/api/reactor/startup-race": {
      POST: guard(async () => Response.json(await startupRace())),
    },
  },

  fetch(req) {
    requestsServed++;
    return Response.json(
      { error: "lost in space — no such deck", path: new URL(req.url).pathname },
      { status: 404 },
    );
  },

  websocket: {
    data: {} as SocketData,
    open(ws) {
      ws.subscribe("telemetry");
      ws.data.session = createEngineSession(msg => ws.send(JSON.stringify(msg)));
    },
    message(ws, raw) {
      let msg: unknown;
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return; // static on the line — not a typed envelope, not our problem
      }
      const type = (msg as { type?: unknown })?.type;
      if (typeof type === "string" && type.startsWith("engine/")) {
        ws.data.session?.handle(msg as EngineClientMsg);
      }
    },
    close(ws) {
      ws.data.session?.dispose();
      ws.data.session = null;
    },
  },
});

// Under `bun --hot` this module re-evaluates on every reload; stop the previous
// heartbeat first or each reload would stack another interval (same pattern as
// the chronometer's job registry).
const TELEMETRY_KEY = Symbol.for("oven1.telemetry.stop");
(globalThis as any)[TELEMETRY_KEY]?.();
const stopTelemetry = startTelemetry({
  getServerCounts: () => ({
    pendingRequests: server.pendingRequests,
    pendingWebSockets: server.pendingWebSockets,
  }),
  getRequestsServed: () => requestsServed,
  publish: frame => server.publish("telemetry", JSON.stringify(frame)),
});
(globalThis as any)[TELEMETRY_KEY] = stopTelemetry;

startShipJobs(job => {
  console.log(dim(`  ⏲ chronometer — ${job} fired at ${new Date().toLocaleTimeString()}`));
});

process.on("SIGINT", () => {
  console.log("\n" + dim("retro-burn: telemetry off, engines safed, hatches sealed. The Oven-1 is docked."));
  stopTelemetry();
  server.stop(true);
  if (typeof Bun.WebView === "function") Bun.WebView.closeAll();
  process.exit(0);
});

console.log(emblemBanner());
console.log(deck("🛰", "Oven-1 · Mission Control", "Bun.serve — routing, bundling, and WebSocket pub/sub in one process"));

const decks = shipStatus().decks;
const online = Object.values(decks).filter(d => d.online).length;
console.log("  " + ok(`flight deck open — ${bold(paint(palette.sky, String(server.url)))}`));
console.log("  " + ok(`telemetry publishing to /ws every 500 ms — ${online}/7 decks online`));
if (!["127.0.0.1", "localhost", "::1"].includes(HOSTNAME)) {
  console.log("  " + warn(`outer airlock open — bound to ${HOSTNAME}, and /ws carries a live shell. Untrusted networks stay outside.`));
}
for (const [name, status] of Object.entries(decks)) {
  if (!status.online) console.log("  " + warn(`${name} idle — ${status.note}`));
}
console.log();
console.log(dim("  zero dependencies, zero build step — one HTML import serves the whole dashboard. ctrl-c to dock."));
