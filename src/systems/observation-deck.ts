/**
 * Observation Deck — `Bun.WebView`, the headless browser that lives inside
 * the runtime. The ship uses it to photograph her own dashboard.
 *
 * The status probe mirrors Bun's own Chrome discovery order (BUN_CHROME_PATH →
 * $PATH → standard installs → Playwright cache) without spawning anything, so
 * the UI can dim this deck honestly on browserless machines.
 */

import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { DeckStatus, SnapshotReport } from "../types";

export const OBS_DIR = ".flight-data/observation";

const PATH_CANDIDATES =
  process.platform === "win32"
    ? ["chrome", "chromium", "brave", "msedge"]
    : [
        "google-chrome-stable",
        "google-chrome",
        "chromium-browser",
        "chromium",
        "brave-browser",
        "microsoft-edge",
        "chrome",
      ];

function installCandidates(): string[] {
  if (process.platform === "darwin") {
    const app = "Google Chrome.app/Contents/MacOS/Google Chrome";
    return [join("/Applications", app), join(homedir(), "Applications", app)];
  }
  return PATH_CANDIDATES.map(name => join("/usr/bin", name)).concat("/snap/bin/chromium");
}

function playwrightHeadlessShell(): string | null {
  const cache =
    process.platform === "darwin"
      ? join(homedir(), "Library/Caches/ms-playwright")
      : process.platform === "win32"
        ? join(process.env.LOCALAPPDATA ?? "", "ms-playwright")
        : join(homedir(), ".cache/ms-playwright");
  let entries: string[];
  try {
    entries = readdirSync(cache);
  } catch {
    return null;
  }
  for (const entry of entries.filter(e => e.startsWith("chrome-headless-shell")).sort().reverse()) {
    for (const sub of ["chrome-linux/headless_shell", "chrome-mac/headless_shell", "chrome-win/headless_shell.exe"]) {
      const path = join(cache, entry, sub);
      if (existsSync(path)) return path;
    }
  }
  return null;
}

function findChrome(): { path: string; source: string } | null {
  const pinned = process.env.BUN_CHROME_PATH;
  if (pinned && existsSync(pinned)) return { path: pinned, source: "BUN_CHROME_PATH" };
  for (const name of PATH_CANDIDATES) {
    const hit = Bun.which(name);
    if (hit) return { path: hit, source: "$PATH" };
  }
  for (const path of installCandidates()) {
    if (existsSync(path)) return { path, source: "standard install" };
  }
  const shell = playwrightHeadlessShell();
  if (shell) return { path: shell, source: "Playwright cache" };
  return null;
}

type ViewOptions = NonNullable<ConstructorParameters<typeof Bun.WebView>[0]>;

/**
 * Chrome refuses its sandbox under root (crbug.com/638180) — common in
 * containers. Bun still discovers the binary itself; we only add the flag.
 */
export function viewBackend(): ViewOptions["backend"] {
  if (process.platform === "darwin") return undefined;
  return process.getuid?.() === 0 ? { type: "chrome", argv: ["--no-sandbox"] } : undefined;
}

export function observationStatus(): DeckStatus {
  if (process.platform === "darwin") {
    return { online: true, note: "WebKit backend — the system WKWebView, nothing to install" };
  }
  const found = findChrome();
  return found
    ? { online: true, note: `Chrome-family browser aboard (${found.source}): ${found.path}` }
    : { online: false, note: "no Chrome-family browser aboard — the Observation Deck idles" };
}

function pngDimensions(png: Buffer, fallbackW: number, fallbackH: number) {
  const isPng = png.length > 24 && png.readUInt32BE(0) === 0x89504e47;
  return isPng
    ? { width: png.readUInt32BE(16), height: png.readUInt32BE(20) }
    : { width: fallbackW, height: fallbackH };
}

export async function snapshot(targetUrl: string): Promise<SnapshotReport> {
  const status = observationStatus();
  if (!status.online) return { ok: false, reason: status.note };

  const t0 = performance.now();
  try {
    await using view = new Bun.WebView({ width: 1280, height: 800, backend: viewBackend() });

    // The constructor returns instantly; the first awaited op absorbs the
    // browser spawn. about:blank isolates that wait from the real navigation.
    await view.navigate("about:blank");
    const spawnMs = performance.now() - t0;

    const n0 = performance.now();
    await view.navigate(targetUrl);
    const navigateMs = performance.now() - n0;

    const evaluated = (await view.evaluate(
      "({ title: document.title, decks: document.querySelectorAll('[data-deck]').length })",
    )) as { title: string; decks: number };

    const s0 = performance.now();
    const shot = await view.screenshot({ encoding: "buffer" });
    const screenshotMs = performance.now() - s0;

    const name = `snapshot-${Date.now()}.png`;
    await Bun.write(join(OBS_DIR, name), shot);

    return {
      ok: true,
      url: targetUrl,
      title: view.title || evaluated.title,
      backend: process.platform === "darwin" ? "webkit" : "chrome",
      asset: { name, bytes: shot.byteLength, ...pngDimensions(shot, 1280, 800) },
      timings: { spawnMs, navigateMs, screenshotMs, totalMs: performance.now() - t0 },
      evaluated,
    };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
}
