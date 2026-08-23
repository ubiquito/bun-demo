/**
 * Engine Room, standalone: why PTYs matter, in three exhibits. The same
 * command lies flat through a pipe and lights up through Bun.Terminal,
 * because only the PTY lets the child believe someone is watching.
 */
import { deck, dim, fail, fmt, gauge, ok, palette, prose, rule } from "../src/lib/theme.ts";
import type { EngineServerMsg } from "../src/types.ts";
import { createEngineSession, engineStatus } from "../src/systems/engine-room.ts";

const beat = () => Bun.sleep(120);
const ENV = { ...process.env, TERM: "xterm-256color" };
const escapesIn = (s: string) => s.length - Bun.stripANSI(s).length;

async function runPiped(cmd: string[]) {
  const t0 = performance.now();
  const proc = Bun.spawn(cmd, { env: ENV, stdout: "pipe", stderr: "ignore" });
  const raw = await new Response(proc.stdout).text();
  await proc.exited;
  return { raw, ms: performance.now() - t0 };
}

async function runOnPty(cmd: string[]) {
  const chunks: Uint8Array[] = [];
  const t0 = performance.now();
  const proc = Bun.spawn(cmd, {
    env: ENV,
    terminal: { cols: 100, rows: 28, data: (_t, bytes) => void chunks.push(bytes) },
  });
  await proc.exited;
  const ms = performance.now() - t0;
  await Bun.sleep(60); // let the last PTY frames land before we close the line
  proc.terminal?.close();
  return { raw: Buffer.concat(chunks).toString(), ms };
}

console.log(deck("⚙️", "Engine Room", "Bun.Terminal — a real PTY, so child processes stop playing dead for pipes"));

const status = engineStatus();
if (!status.online) {
  console.log(fail(`engine offline — ${status.note}`));
  process.exit(0);
}
console.log(ok(status.note));

// ── Exhibit A · the same command, both ways ────────────────────────────────
const ls = Bun.which("ls");
if (ls) {
  // GNU ls speaks --color=auto; BSD ls colors with -G. Both only when a TTY looks back.
  const gnu = Bun.spawnSync([ls, "--color=auto", "/"], { stdout: "ignore", stderr: "ignore" }).exitCode === 0;
  const cmd = gnu ? [ls, "--color=auto", "/"] : [ls, "-G", "/"];

  await beat();
  console.log();
  console.log(dim(`  ── exhibit A · \`${cmd.slice(0, 2).join(" ")} /\` into a pipe — the child plays it safe ──`));
  const piped = await runPiped(cmd);
  console.log();
  console.log(piped.raw.split("\n").slice(0, 2).map(l => `    ${l}`).join("\n"));
  console.log();
  console.log(gauge("stdout captured", `${fmt.bytes(Buffer.byteLength(piped.raw))} in ${fmt.ms(piped.ms)}`, palette.sky));
  console.log(gauge("ANSI escape chars (length − stripANSI length)", `${escapesIn(piped.raw)} — it saw a pipe, so no paint`, palette.hull));

  await beat();
  console.log();
  console.log(dim("  ── exhibit B · the identical command through a Bun.Terminal PTY ──"));
  const pty = await runOnPty(cmd);
  console.log();
  console.log(pty.raw.split("\r\n").slice(0, 2).map(l => `    ${l}`).join("\n"));
  console.log();
  console.log(gauge("PTY frames captured", `${fmt.bytes(Buffer.byteLength(pty.raw))} in ${fmt.ms(pty.ms)}`, palette.sky));
  console.log(gauge("ANSI escape chars", `${fmt.int(escapesIn(pty.raw))} — the child believed it had a terminal`, palette.flame));
} else {
  console.log(dim("  no `ls` aboard this hull — skipping the color exhibit, the TTY oath below still tells the tale"));
}

// ── Exhibit B½ · ask the child directly ────────────────────────────────────
await beat();
console.log();
console.log(dim("  ── the child under oath · bun -e \"console.log(!!process.stdout.isTTY)\" ──"));
const oath = [process.execPath, "-e", "console.log(!!process.stdout.isTTY)"];
const oathPiped = (await runPiped(oath)).raw.trim();
const oathPty = Bun.stripANSI((await runOnPty(oath)).raw).trim();
console.log(gauge("spawned with stdout: \"pipe\"", `isTTY → ${oathPiped}`, palette.hull));
console.log(gauge("spawned with terminal: { … }", `isTTY → ${oathPty}`, palette.mint));

// ── Exhibit C · one terminal, two burns ────────────────────────────────────
await beat();
console.log();
console.log(dim("  ── exhibit C · one reusable Bun.Terminal, two sequential spawns ──"));
const sharedLog: string[] = [];
const shared = new Bun.Terminal({
  cols: 100,
  rows: 28,
  data: (_t, bytes) => void sharedLog.push(Buffer.from(bytes).toString()),
});
for (const batch of ["batch one away — 700,000 buns", "batch two away — 700,000 more"]) {
  const burn = Bun.spawn(["echo", batch], { terminal: shared, env: ENV });
  await burn.exited;
}
await Bun.sleep(60);
shared.close();
console.log();
console.log(sharedLog.join("").trimEnd().split("\r\n").map(l => `    ${l}`).join("\n"));
console.log();
console.log(gauge("terminals opened / processes flown", "1 / 2 — same line, fresh child each time", palette.caramel));

// ── Exhibit D · the wired session the flight deck uses ─────────────────────
await beat();
console.log();
console.log(dim("  ── exhibit D · createEngineSession() — the same PTY, wired for WebSocket duty ──"));
const inbox: EngineServerMsg[] = [];
const session = createEngineSession(msg => inbox.push(msg));
const t0 = performance.now();
session.handle({ type: "engine/start" });
session.handle({ type: "engine/resize", cols: 100, rows: 28 });
session.handle({ type: "engine/write", data: 'echo "glaze $((1300 + 100)) nominal"\nexit\n' });
while (!inbox.some(m => m.type === "engine/exit") && performance.now() - t0 < 8000) await Bun.sleep(25);
const sessionMs = performance.now() - t0;
session.dispose();
session.dispose(); // twice, on purpose — dispose is sworn idempotent

const frames = inbox.filter(m => m.type === "engine/data");
const streamed = frames.map(m => Buffer.from(m.data, "base64").toString()).join("");
const exit = inbox.find(m => m.type === "engine/exit");
const spokePrompt = streamed.includes("oven-1:");
const didMath = Bun.stripANSI(streamed).includes("glaze 1400 nominal");

console.log();
console.log(gauge("shell round trip (start → typed → exit)", fmt.ms(sessionMs), palette.sky));
console.log(gauge("base64 envelopes → bytes streamed", `${frames.length} frames · ${fmt.bytes(Buffer.byteLength(streamed))}`, palette.sky));
console.log(spokePrompt ? ok("custom PS1 came up — the shell greeted us as oven-1") : fail("prompt never surfaced"));
console.log(didMath
  ? ok('a live shell did the math: $((1300 + 100)) → "glaze 1400 nominal"')
  : fail("shell output missing — the engine never answered"));
console.log(exit ? ok(`engine/exit received — shell landed with code ${exit.code}`) : fail("no engine/exit envelope"));

await beat();
console.log();
console.log(rule());
console.log();
console.log(dim(prose(
  "Why it matters: colors, progress bars, REPLs, and password prompts all vanish the moment " +
  "a child sees a pipe instead of a terminal. A PTY used to mean node-pty and a node-gyp " +
  "compile; Bun.Terminal is built into the runtime — one option on Bun.spawn and the child " +
  "gets a real TTY you can write, resize, and stream to a browser.",
)));
console.log();

if (!spokePrompt || !didMath || !exit) process.exit(1);
