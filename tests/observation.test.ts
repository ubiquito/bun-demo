import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OBS_DIR, observationStatus, snapshot, viewBackend } from "../src/systems/observation-deck.ts";

const ROOT = join(import.meta.dir, "..");

describe("observation deck (src/systems/observation-deck.ts)", () => {
  test("OBS_DIR honors the frozen contract path", () => {
    expect(OBS_DIR).toBe(".flight-data/observation");
  });

  test("observationStatus reports an honest DeckStatus", () => {
    const status = observationStatus();
    expect(status.online).toBeBoolean();
    expect(status.note).toBeString();
    expect(status.note.length).toBeGreaterThan(0);
    if (process.platform === "darwin") expect(status.online).toBe(true);
    // Whichever way the probe lands, the note explains itself.
    if (status.online && process.platform !== "darwin") {
      expect(status.note).toContain("Chrome-family browser aboard");
    }
    if (!status.online) expect(status.note).toContain("no Chrome-family browser aboard");
  });

  test("viewBackend only reaches for --no-sandbox where Chrome demands it", () => {
    const backend = viewBackend();
    if (process.platform === "darwin" || process.getuid?.() !== 0) {
      expect(backend).toBeUndefined();
    } else {
      expect(backend).toEqual({ type: "chrome", argv: ["--no-sandbox"] });
    }
  });
});

// The offline path: with env-driven discovery scrubbed (no BUN_CHROME_PATH, an
// empty $PATH, a bare $HOME so no Playwright cache), findChrome comes up empty —
// unless this machine has a browser at a fixed install location env can't hide.
// macOS always flies WKWebView, so it can never be forced browserless.
const fixedInstalls =
  process.platform === "darwin" || process.platform === "win32"
    ? [] // darwin skips anyway; win32 install roots come from env vars we scrub
    : [
        "google-chrome-stable", "google-chrome", "chromium-browser", "chromium",
        "brave-browser", "microsoft-edge", "chrome",
      ].map(name => `/usr/bin/${name}`).concat("/snap/bin/chromium");
const canForceBrowserless = process.platform !== "darwin" && !fixedInstalls.some(p => existsSync(p));

describe.skipIf(!canForceBrowserless)("observation deck, browserless", () => {
  test("snapshot fails soft with the friendly deck-idle reason", async () => {
    const bareHome = mkdtempSync(join(tmpdir(), "oven1-bare-home-"));
    const probe = join(bareHome, "probe.ts");
    await Bun.write(
      probe,
      `import { observationStatus, snapshot } from ${JSON.stringify(join(ROOT, "src/systems/observation-deck.ts"))};
       console.log(JSON.stringify({ status: observationStatus(), report: await snapshot("http://localhost:1414") }));`,
    );
    const scrubbed = Bun.spawn({
      cmd: [process.execPath, probe],
      cwd: ROOT,
      env: { HOME: bareHome, USERPROFILE: bareHome, PATH: "", SystemRoot: process.env.SystemRoot ?? "" },
      stdout: "pipe",
      stderr: "ignore",
    });
    const out = await new Response(scrubbed.stdout).text();
    expect(await scrubbed.exited).toBe(0);
    const { status, report } = JSON.parse(out);
    expect(status.online).toBe(false);
    expect(status.note).toContain("no Chrome-family browser aboard");
    expect(report.ok).toBe(false);
    expect(report.reason).toBe(status.note); // the API hands back the same friendly note
  }, 20_000);
});

describe.skipIf(!observationStatus().online)("observation deck, browser aboard", () => {
  test("snapshot photographs a live page and reports it truthfully", async () => {
    // A tiny pane with a unicode title — the same middle dot the dashboard flies.
    const pane = Bun.serve({
      port: 0,
      fetch: () =>
        new Response("<title>Oven-1 · Test Pane</title><div data-deck='test'></div>", {
          headers: { "content-type": "text/html; charset=utf-8" },
        }),
    });
    try {
      const report = await snapshot(`http://localhost:${pane.port}`);
      expect(report.ok).toBe(true);
      if (!report.ok) return;
      // Regression: Bun 1.4.0's view.title getter returns the JSON-escaped
      // string ("Oven-1 \\u00b7 …"); the report must carry the decoded title.
      expect(report.title).toBe("Oven-1 · Test Pane");
      expect(report.evaluated).toEqual({ title: "Oven-1 · Test Pane", decks: 1 });
      expect(report.asset!.name).toMatch(/^snapshot-\d{10,16}-\d{1,6}\.png$/);
      expect(report.asset!.bytes).toBeGreaterThan(0);
      expect(report.asset!.width).toBeGreaterThan(0);
      expect(existsSync(join(ROOT, OBS_DIR, report.asset!.name))).toBe(true);
      expect(report.timings!.totalMs).toBeGreaterThan(0);
    } finally {
      pane.stop(true);
    }
  }, 60_000);

  test("concurrent snapshots never develop onto the same plate", async () => {
    const pane = Bun.serve({
      port: 0,
      fetch: () => new Response("<title>plate test</title>", { headers: { "content-type": "text/html" } }),
    });
    try {
      const url = `http://localhost:${pane.port}`;
      const reports = await Promise.all([snapshot(url), snapshot(url)]);
      const names = reports.map(r => (r.ok ? r.asset!.name : r.reason));
      expect(reports.every(r => r.ok)).toBe(true);
      expect(new Set(names).size).toBe(2);
    } finally {
      pane.stop(true);
    }
  }, 60_000);
});
