import { describe, expect, test } from "bun:test";
import { detectCarrier, itermInlineEscape, kittyShmemEscape } from "../src/lib/postcard";

// detectCarrier is pure and injectable for exactly this reason: feed it fake
// environments and pin down who it thinks is on the other end of stdout.
describe("detectCarrier", () => {
  const cases: Array<{
    name: string;
    env: Record<string, string | undefined>;
    protocol: "kitty" | "iterm2" | "none";
    via?: string;
  }> = [
    { name: "kitty itself", env: { KITTY_WINDOW_ID: "1" }, protocol: "kitty", via: "kitty" },
    { name: "TERM claiming kitty", env: { TERM: "xterm-kitty" }, protocol: "kitty", via: "TERM=xterm-kitty" },
    { name: "WezTerm by executable", env: { WEZTERM_EXECUTABLE: "/usr/bin/wezterm-gui" }, protocol: "kitty", via: "WezTerm" },
    { name: "WezTerm by TERM_PROGRAM", env: { TERM_PROGRAM: "WezTerm" }, protocol: "kitty", via: "WezTerm" },
    { name: "Konsole", env: { KONSOLE_VERSION: "230804" }, protocol: "kitty", via: "Konsole" },
    { name: "iTerm2", env: { TERM_PROGRAM: "iTerm.app" }, protocol: "iterm2", via: "iTerm2" },
    { name: "plain xterm", env: { TERM: "xterm-256color" }, protocol: "none" },
    { name: "a bare CI environment", env: {}, protocol: "none" },
    { name: "an unknown TERM_PROGRAM", env: { TERM_PROGRAM: "Apple_Terminal", TERM: "xterm-256color" }, protocol: "none" },
  ];

  for (const c of cases) {
    test(c.name, () => {
      const carrier = detectCarrier(c.env);
      expect(carrier.protocol).toBe(c.protocol);
      if (c.via) expect((carrier as { via?: string }).via).toBe(c.via);
    });
  }

  test("KITTY_WINDOW_ID outranks the other signals", () => {
    const carrier = detectCarrier({ KITTY_WINDOW_ID: "2", TERM_PROGRAM: "iTerm.app" });
    expect(carrier).toEqual({ protocol: "kitty", via: "kitty" });
  });
});

describe("kittyShmemEscape", () => {
  test("speaks t=s with the byte size and the base64 segment name", () => {
    const esc = kittyShmemEscape("/bun-chrome-42-1", 226039);
    expect(esc).toBe(`\x1b_Gf=100,t=s,a=T,S=226039;${btoa("/bun-chrome-42-1")}\x1b\\`);
  });
});

describe("itermInlineEscape", () => {
  test("declares the decoded byte count, not the base64 length", () => {
    const b64 = btoa("ten bytes!"); // 10 bytes → 16 base64 chars with padding
    const esc = itermInlineEscape(b64, "card.png");
    expect(esc).toBe(`\x1b]1337;File=name=${btoa("card.png")};size=10;inline=1:${b64}\x07`);
  });

  test("padding math holds for every remainder", () => {
    for (const text of ["a", "ab", "abc", "abcd"]) {
      const esc = itermInlineEscape(btoa(text));
      expect(esc).toContain(`;size=${text.length};`);
    }
  });
});
