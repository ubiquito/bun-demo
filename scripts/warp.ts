/**
 * Warp Drive — `Bun.serve({ http3: true })`, the experimental QUIC engine
 * new in Bun 1.4. One port, two fabrics: TCP carries good old HTTP/1.1,
 * a QUIC listener opens on the same port over UDP, and every response
 * advertises the jump route in an `alt-svc: h3` header. This is a demo
 * burn, not a daemon: light the coil, measure the physics, power down.
 */
import { join } from "node:path";
import { existsSync, mkdirSync } from "node:fs";
import { bold, deck, dim, fail, fmt, gauge, ok, paint, palette, prose, rule, warn } from "../src/lib/theme.ts";

// Artifacts live in `.flight-data/warp/` at the repo root, wherever the crew launched from.
process.chdir(join(import.meta.dir, ".."));

const PORT = 14434;
const HOSTNAME = "127.0.0.1";
const ORIGIN = `https://${HOSTNAME}:${PORT}`;
const WARP_DIR = ".flight-data/warp";
const HOLD = process.argv.includes("--hold");
const beat = () => Bun.sleep(110);

console.log(deck("🌀", "Warp Drive", "Bun.serve({ http3: true }) — experimental QUIC over UDP, advertised by alt-svc, measured honestly"));

// ── pre-flight: a warp field needs a certificate to bend ───────────────────
const openssl = Bun.which("openssl");
if (!openssl) {
  console.log(warn("no openssl aboard — warp drive needs a self-signed certificate; install openssl or bring your own tls"));
  process.exit(0);
}
console.log(ok(`openssl found: ${openssl} ${dim("— certificate forge is hot")}`));

const certPath = join(WARP_DIR, "cert.pem");
const keyPath = join(WARP_DIR, "key.pem");

if (existsSync(certPath) && existsSync(keyPath)) {
  console.log(ok(`warp coil already wound — reusing the certificate in ${WARP_DIR}/ ${dim("(delete the folder to re-forge)")}`));
} else {
  mkdirSync(WARP_DIR, { recursive: true });
  const t0 = performance.now();
  const forge = Bun.spawnSync(
    [
      openssl, "req", "-x509",
      "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:prime256v1",
      "-keyout", keyPath, "-out", certPath,
      "-days", "825", "-nodes",
      "-subj", "/CN=localhost/O=Orbital Bakery/OU=Warp Drive",
      "-addext", "subjectAltName=DNS:localhost,IP:127.0.0.1",
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  if (forge.exitCode !== 0) {
    const grumble = forge.stderr.toString().trim().split("\n").at(-1) ?? "no diagnostics";
    console.log(warn(`the certificate forge jammed (openssl exit ${forge.exitCode}: ${grumble}) — no field, no jump today`));
    process.exit(0);
  }
  console.log(gauge("forge self-signed cert — EC P-256, CN=localhost", fmt.ms(performance.now() - t0), palette.flame));
}

// ── ignition: TCP and QUIC on the same pad ─────────────────────────────────
await beat();

const SHIP_HEADERS = { "x-ship": "Oven-1" };

const BRIDGE_VIEW = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Oven-1 · Warp Drive</title>
<style>
  body{background:#0b1020;color:#94a3b8;font:16px/1.6 ui-monospace,monospace;
       display:grid;place-items:center;min-height:100vh;margin:0}
  main{max-width:34rem;padding:2rem}
  h1{color:#f9a8d4;font-size:1.4rem;letter-spacing:.2em}
  code{color:#6ee7b7}  em{color:#fde68a;font-style:normal}
</style></head><body><main>
  <h1>🌀 WARP DRIVE</h1>
  <p>You reached the Oven-1 over TLS. This response rode <em>HTTP/1.1</em>,
  but check the <code>alt-svc</code> header: a QUIC listener hums on the
  same port over UDP, offering <code>h3</code> to any client bold enough
  to take the jump.</p>
  <p><code>GET /api/warp</code> reports drive status. Experimental engine —
  Bun 1.4 — mind the plasma.</p>
</main></body></html>`;

type WarpServer = ReturnType<typeof Bun.serve>;
let server: WarpServer;
const t0 = performance.now();
try {
  server = Bun.serve({
    port: PORT,
    hostname: HOSTNAME,
    tls: { cert: Bun.file(certPath), key: Bun.file(keyPath) },
    http3: true, // the experimental flag this whole deck exists to demonstrate
    routes: {
      "/": new Response(BRIDGE_VIEW, {
        headers: { "content-type": "text/html; charset=utf-8", ...SHIP_HEADERS },
      }),
      "/api/warp": Response.json(
        { engaged: true, protocol: "h3 advertised" },
        { headers: SHIP_HEADERS },
      ),
    },
  });
} catch (err) {
  const reason = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  if (reason.includes("EADDRINUSE") || (err as { code?: string })?.code === "EADDRINUSE") {
    console.log(warn(`another craft is parked on ${HOSTNAME}:${PORT} — clear the pad and run \`bun run warp\` again`));
  } else {
    console.log(fail(`the http3 coil threw on this build — ${reason}`));
    console.log(dim(prose(
      "That, too, is a truthful demo of an experimental flag: `http3` is new in Bun 1.4 " +
      "and marked experimental for exactly this reason. Nothing else on the ship depends on it.",
    )));
  }
  process.exit(0);
}
const bootMs = performance.now() - t0;

console.log(gauge(`ignite Bun.serve — TCP (h1) + QUIC/UDP (h3) on :${PORT}`, fmt.ms(bootMs), palette.flame));
console.log(ok(`warp drive online at ${bold(server.url.href)}`));

// ── the physics, measured ──────────────────────────────────────────────────
await beat();
console.log();
console.log(dim("  ── flight telemetry · one real request, headers read off the wire ──"));
console.log();
console.log(warn(`probe skips TLS verification ${dim("— demo-only self-signed cert on loopback; never fly this setting in production")}`));

let altSvc: string | null = null;
try {
  const tProbe = performance.now();
  const res = await fetch(`${ORIGIN}/`, { tls: { rejectUnauthorized: false } });
  const probeMs = performance.now() - tProbe;
  await res.text(); // drain, so the socket is politely returned
  altSvc = res.headers.get("alt-svc");

  console.log(gauge("GET / — TLS handshake + response (HTTP/1.1)", `${res.status} · ${fmt.ms(probeMs)}`, palette.mint));
  console.log(altSvc
    ? gauge("alt-svc", altSvc, palette.glow) // the money shot: the ship advertising its own jump route
    : gauge("alt-svc", "— not advertised (unexpected; the QUIC coil may be dark on this build)", palette.alarm));

  const api = await fetch(`${ORIGIN}/api/warp`, { tls: { rejectUnauthorized: false } });
  console.log(gauge("GET /api/warp", `${api.status} · ${await api.text()}`, palette.sky));
} catch (err) {
  console.log(fail(`the probe bounced off our own hull — ${err instanceof Error ? err.message : String(err)}`));
}

// The QUIC side is UDP — cheap to sight from the tower, when the tower has windows.
const sighting = await quicListenerSighting();
console.log(sighting
  ? gauge("quic listener (udp side)", sighting, palette.caramel)
  : dim("  couldn't sight the UDP listener from here (no ss, no /proc/net/udp) — the alt-svc header above is still the advertisement"));

async function quicListenerSighting(): Promise<string | null> {
  const ss = Bun.which("ss");
  if (ss) {
    const scan = Bun.spawnSync([ss, "-ulnp"], { stdout: "pipe", stderr: "pipe" });
    const line = scan.stdout.toString().split("\n").find(l => l.includes(`:${PORT} `));
    if (line) return `ss: bound on ${HOSTNAME}:${PORT}`;
  }
  // No ss aboard? Linux keeps the manifest in /proc — port in uppercase hex.
  try {
    const hex = PORT.toString(16).toUpperCase().padStart(4, "0");
    const table = await Bun.file("/proc/net/udp").text();
    if (table.split("\n").some(l => l.includes(`0100007F:${hex}`))) {
      return `/proc/net/udp: bound on ${HOSTNAME}:${PORT}`;
    }
  } catch {
    // not Linux, or /proc is shy — fall through to the honest shrug
  }
  return null;
}

// ── debrief, precisely worded ──────────────────────────────────────────────
await beat();
console.log();
console.log(rule());
console.log();
console.log(dim(prose(
  "Precision is the charm: HTTP/3 in Bun.serve is experimental in 1.4. What you just " +
  "measured is real — a QUIC listener on UDP sharing the TCP port, and a live alt-svc " +
  "header inviting clients to upgrade — but a full QUIC handshake needs an h3-capable " +
  "client (this probe, like most curls, negotiated HTTP/1.1). And Bun.serve does not " +
  "speak HTTP/2 at all: the ship jumps straight from 1.1 to 3, no intermediate warp factor.",
)));
console.log();
console.log(dim(`  \`bun run warp --hold\` keeps the drive humming so a human with an h3-capable browser can visit ${ORIGIN}/ (accept the self-signed cert).`));
console.log();

if (HOLD) {
  console.log(ok(`holding at warp — ${bold("Ctrl-C")} drops us back to sublight`));
  process.on("SIGINT", () => {
    console.log();
    console.log(ok("warp field collapsed cleanly — see you at sublight"));
    process.exit(0);
  });
  // Bun.serve keeps the event loop (and the field) alive from here.
} else {
  server.stop(true);
  console.log(ok(`demo burn complete — drive powered down, certificate cached in ${paint(palette.sky, WARP_DIR + "/")} for the next jump`));
  console.log();
  process.exit(0);
}
