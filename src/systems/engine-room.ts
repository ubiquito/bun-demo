/**
 * Engine Room — a real shell on a real PTY, courtesy of Bun.Terminal.
 * Each session lazily ignites one interactive shell; raw PTY bytes stream
 * out as base64 envelopes and keystrokes stream back in, so the browser
 * xterm and the child process both believe they share a genuine terminal.
 */
import type { DeckStatus, EngineClientMsg, EngineServerMsg } from "../types.ts";

const COLS = 100;
const ROWS = 28;
const PROMPT = "oven-1:\\w $ ";

const clampDim = (n: number, fallback: number) =>
  Number.isFinite(n) ? Math.min(Math.max(Math.trunc(n), 2), 500) : fallback;

export function engineStatus(): DeckStatus {
  if (typeof Bun.Terminal !== "function") {
    return { online: false, note: "Bun.Terminal not aboard — PTYs shipped with Bun 1.4, this hull is older" };
  }
  const bash = Bun.which("bash");
  return {
    online: true,
    note: bash ? `PTY ready — bash at ${bash}` : "PTY ready — no bash aboard, sh will hold the throttle",
  };
}

/**
 * One engine session: at most one live shell, spawned on `engine/start`.
 * `dispose()` is idempotent and never throws — safe to call from any
 * socket-close path, however many times it fires.
 */
export function createEngineSession(
  send: (msg: EngineServerMsg) => void,
): { handle(msg: EngineClientMsg): void; dispose(): void } {
  let proc: Bun.Subprocess | null = null;
  let disposed = false;

  const relay = (msg: EngineServerMsg) => {
    if (disposed) return;
    try {
      send(msg);
    } catch {
      // the socket left orbit mid-frame; the session will be disposed shortly
    }
  };

  const ignite = () => {
    if (proc || disposed) return; // one engine per session — no stacking burns
    const shell = Bun.which("bash") ?? "sh";
    const child = Bun.spawn({
      // --norc keeps dotfiles from repainting our PS1 mid-flight
      cmd: shell.endsWith("bash") ? [shell, "--norc", "--noprofile", "-i"] : [shell, "-i"],
      env: { ...process.env, TERM: "xterm-256color", PS1: PROMPT },
      terminal: {
        cols: COLS,
        rows: ROWS,
        data(_terminal, bytes) {
          relay({ type: "engine/data", data: bytes.toBase64() });
        },
      },
      onExit(_sub, exitCode) {
        if (proc === child) proc = null;
        try {
          if (!child.terminal?.closed) child.terminal?.close();
        } catch {}
        relay({ type: "engine/exit", code: exitCode });
      },
    });
    proc = child;
  };

  return {
    handle(msg: EngineClientMsg): void {
      if (disposed) return;
      switch (msg.type) {
        case "engine/start":
          ignite();
          break;
        case "engine/write":
          if (typeof msg.data === "string") proc?.terminal?.write(msg.data);
          break;
        case "engine/resize":
          proc?.terminal?.resize(clampDim(msg.cols, COLS), clampDim(msg.rows, ROWS));
          break;
      }
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      const child = proc;
      proc = null;
      try {
        if (!child?.terminal?.closed) child?.terminal?.close();
      } catch {}
      try {
        child?.kill();
      } catch {}
    },
  };
}
