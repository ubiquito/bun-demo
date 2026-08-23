import { afterAll, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const SERVER = join(ROOT, "src/server.ts");
const aboard = existsSync(SERVER);

// server.ts calls Bun.serve at module top level, so the flight deck gets its
// own process on an OS-picked free port — parallel test runs never collide.
function freePort(): number {
  const probe = Bun.serve({ port: 0, fetch: () => new Response("") });
  const port = probe.port!;
  probe.stop(true);
  return port;
}

let ship: Bun.Subprocess | null = null;

async function liftOff(): Promise<string> {
  const port = freePort();
  ship = Bun.spawn({
    cmd: [process.execPath, SERVER],
    cwd: ROOT,
    env: { ...process.env, PORT: String(port) },
    stdout: "ignore",
    stderr: "ignore",
  });
  const base = `http://localhost:${port}`;
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${base}/api/status`);
      if (res.status === 200) return base;
    } catch {}
    await Bun.sleep(50);
  }
  throw new Error("flight deck did not answer /api/status within 5 s");
}

afterAll(() => {
  ship?.kill();
});

describe.skipIf(!aboard)("flight deck (src/server.ts)", () => {
  test("boots, answers /api/status truthfully, and renders comms on request", async () => {
    const base = await liftOff();

    const status = await (await fetch(`${base}/api/status`)).json();
    expect(status.ship).toBe("Oven-1");
    expect(status.mission).toBe("ORBITAL BAKERY");
    expect(status.bun.version).toBe(Bun.version);
    expect(status.pid).toBeGreaterThan(0);
    expect(status.startedAt).toBeGreaterThan(0);

    const decks = [
      "photonOven", "observationDeck", "commsBay", "chronometer",
      "engineRoom", "cargoHold", "reactor",
    ];
    expect(Object.keys(status.decks).sort()).toEqual([...decks].sort());
    for (const deck of decks) {
      expect(status.decks[deck].online).toBeBoolean();
      expect(status.decks[deck].note).toBeString();
    }

    const comms = await fetch(`${base}/api/comms/render`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ markdown: "# Hail, Oven-1\n\nfresh **buns** inbound" }),
    });
    expect(comms.status).toBe(200);
    const rendered = await comms.json();
    expect(rendered.html).toContain("<h1");
    expect(rendered.html).toContain("<strong>buns</strong>");
    expect(rendered.ansi).toContain("\x1b[");
    expect(rendered.custom.length).toBeGreaterThan(0);
  }, 15_000);
});
