/**
 * Observation Deck — Bun.WebView drives a real headless browser with zero
 * dependencies. No server needed: the whole page ships as a data: URL.
 */

import { join } from "node:path";
import { deck, dim, fail, fmt, gauge, ok, palette, warn } from "../src/lib/theme";
import { OBS_DIR, observationStatus, viewBackend } from "../src/systems/observation-deck";

const postcard = `<meta charset="utf-8">
<title>Postcard from Orbit — Oven-1</title>
<style>
  body { margin:0; height:100vh; display:grid; place-items:center; color:#e2e8f0;
         background:#020617 radial-gradient(90rem 40rem at 70% -20%, #1e293b, transparent);
         font:16px/1.6 ui-monospace, SFMono-Regular, Menlo, monospace; }
  .card { width:34rem; padding:2.4rem 2.8rem; border:1px solid #334155; border-radius:14px;
          background:linear-gradient(160deg,#0f172a,#020617); box-shadow:0 0 4rem #f9a8d422; }
  h1 { margin:0; font-size:1.35rem; letter-spacing:.14em; color:#f9a8d4; }
  .sub { color:#94a3b8; margin:.3rem 0 1.6rem; }
  button { padding:.6rem 1.2rem; border:1px solid #7dd3fc; border-radius:8px; cursor:pointer;
           background:transparent; color:#7dd3fc; font:inherit; }
  button:active { background:#7dd3fc22; }
  input { display:block; width:100%; margin:1rem 0; padding:.6rem .8rem; box-sizing:border-box;
          border:1px solid #334155; border-radius:8px; background:#0b1120; color:#fde68a; font:inherit; }
  #stamp { color:#6ee7b7; }
</style>
<div class="card">
  <h1>OVEN-1 · OBSERVATION DECK</h1>
  <div class="sub">postcard from low bun orbit — wish you were here</div>
  <button id="wave">wave to the crew</button>
  <input id="callsign" placeholder="leave a message for the galley…" autocomplete="off">
  <div id="stamp">◌ awaiting contact</div>
</div>
<script>
  const log = { wave: null, enter: null, sent: "" };
  window.__postcard = log;
  wave.addEventListener("click", e => {
    log.wave = e.isTrusted;
    wave.textContent = "the crew waves back ✶";
    stamp.textContent = "◆ contact confirmed";
  });
  callsign.addEventListener("keydown", e => {
    if (e.key !== "Enter") return;
    log.enter = e.isTrusted;
    log.sent = callsign.value;
    stamp.textContent = "◆ message pinned to the galley board";
  });
</script>`;

console.log(deck("🔭", "Observation Deck", "Bun.WebView — a headless browser living inside the runtime"));

const status = observationStatus();
if (!status.online) {
  console.log(warn(status.note));
  console.log(dim("  Dock a Chrome, Chromium, Edge, or Brave and this deck lights right up."));
  process.exit(0);
}
console.log(ok(status.note));
console.log();

const message = "fresh buns, back by tuesday";

try {
  const t0 = performance.now();
  await using view = new Bun.WebView({ width: 1280, height: 800, backend: viewBackend() });
  await view.navigate("about:blank"); // first awaited op absorbs the browser spawn
  console.log(gauge("browser on deck (spawn + first contact)", fmt.ms(performance.now() - t0)));

  const nav0 = performance.now();
  await view.navigate("data:text/html," + encodeURIComponent(postcard));
  console.log(gauge("postcard rendered from a data: URL", fmt.ms(performance.now() - nav0)));

  const click0 = performance.now();
  await view.click("#wave");
  const waveTrusted = await view.evaluate("__postcard.wave");
  console.log(gauge("native click on #wave", fmt.ms(performance.now() - click0), palette.sky));
  if (waveTrusted !== true) {
    console.log(fail(`the page recorded event.isTrusted === ${JSON.stringify(waveTrusted)}`));
    process.exit(1);
  }
  console.log(ok("the page saw a REAL user: isTrusted === true — no synthetic events here"));
  console.log();

  const type0 = performance.now();
  await view.click("#callsign");
  await view.type(message);
  await view.press("Enter");
  const echoed = await view.evaluate("document.querySelector('#callsign').value");
  console.log(gauge("focus · type · press Enter", fmt.ms(performance.now() - type0), palette.sky));
  if (echoed !== message) {
    console.log(fail(`the input read back "${echoed}" — expected "${message}"`));
    process.exit(1);
  }
  console.log(ok(`the input echoes back: "${echoed}"`));
  console.log();

  const shot0 = performance.now();
  const shot = (await view.screenshot({ encoding: "buffer" })) as Buffer;
  const target = join(OBS_DIR, "postcard.png");
  await Bun.write(target, shot);
  const dims = `${shot.readUInt32BE(16)}×${shot.readUInt32BE(20)}`; // measured from the PNG header
  console.log(gauge(`viewport photographed (${dims} PNG)`, fmt.ms(performance.now() - shot0)));
  console.log(gauge("postcard developed", `${fmt.bytes(shot.byteLength)} → ${target}`, palette.star));
  console.log(gauge("full observation pass", fmt.ms(performance.now() - t0), palette.glow));

  console.log();
  console.log(
    dim("  Browser automation — trusted input, page evals, screenshots — with zero dependencies to install."),
  );
} catch (err) {
  console.log(fail(`the observation window fogged up: ${err instanceof Error ? err.message : err}`));
  process.exit(1);
}
