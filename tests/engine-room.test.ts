import { describe, expect, test } from "bun:test";
import { createEngineSession, engineStatus } from "../src/systems/engine-room.ts";
import type { EngineServerMsg } from "../src/types.ts";

// One shell, one PTY, spawned and disposed inside a single test — nothing
// here leans on shared state, so --parallel runs are safe.

function boot() {
  let text = "";
  const frames: EngineServerMsg[] = [];
  const session = createEngineSession(msg => {
    frames.push(msg);
    if (msg.type === "engine/data") text += Buffer.from(msg.data, "base64").toString("utf8");
  });
  return { session, frames, decoded: () => text };
}

async function until(pred: () => boolean, timeoutMs = 10_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (pred()) return true;
    await Bun.sleep(25);
  }
  return pred();
}

describe("engine room", () => {
  test("deck reports online", () => {
    expect(engineStatus().online).toBeTrue();
  });

  test("PTY round-trip: keystrokes in, base64 frames out, and the child sees a real TTY", async () => {
    const { session, frames, decoded } = boot();
    session.handle({ type: "engine/start" });

    // $((...)) arithmetic keeps the expected strings out of the local echo,
    // so a match proves the shell ran the command — not that it merely heard it
    session.handle({ type: "engine/write", data: "printf 'ROUNDTRIP_%s\\n' $((40 + 2))\n" });
    expect(await until(() => decoded().includes("ROUNDTRIP_42"))).toBeTrue();

    session.handle({ type: "engine/write", data: "[ -t 0 ] && echo TTY_$((99 + 1))\n" });
    expect(await until(() => decoded().includes("TTY_100"))).toBeTrue();

    expect(frames.some(f => f.type === "engine/data")).toBeTrue();
    session.dispose();
  }, 15_000);

  test("resize is accepted mid-flight and the shell answers with its new width", async () => {
    const { session, decoded } = boot();
    session.handle({ type: "engine/start" });
    session.handle({ type: "engine/resize", cols: 61, rows: 19 });
    session.handle({ type: "engine/write", data: "echo COLS_$(tput cols)\n" });
    expect(await until(() => decoded().includes("COLS_61"))).toBeTrue();
    session.dispose();
  }, 15_000);

  test("dispose is idempotent and goes quiet", async () => {
    const { session, decoded } = boot();
    session.handle({ type: "engine/start" });
    session.handle({ type: "engine/write", data: "echo ALIVE_$((1 + 1))\n" });
    expect(await until(() => decoded().includes("ALIVE_2"))).toBeTrue();

    session.dispose();
    session.dispose(); // second landing burns nothing
    session.handle({ type: "engine/write", data: "echo GHOST\n" }); // ignored, no throw
    expect(decoded()).not.toContain("GHOST");
  }, 15_000);
});
