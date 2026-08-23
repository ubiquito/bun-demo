import { describe, expect, test } from "bun:test";
import { commsStatus, missionLog, renderAll } from "../src/systems/comms.ts";

const report = renderAll(missionLog());

describe("comms bay", () => {
  test("deck reports online", () => {
    const status = commsStatus();
    expect(status.online).toBeTrue();
    expect(status.note.length).toBeGreaterThan(0);
  });

  test("mission log is real markdown, not a stub", () => {
    const log = missionLog();
    expect(log).toStartWith("# Oven-1");
    expect(report.chars).toBe(log.length);
  });
});

describe("html renderer", () => {
  test("headings carry slugified ids", () => {
    expect(report.html).toMatch(/<h1 id="[a-z0-9-]+"/);
    expect(report.html).toContain('<h2 id="ship-status"');
  });

  test("GFM extensions all fire: table, strikethrough, task list", () => {
    expect(report.html).toContain("<table>");
    expect(report.html).toContain("<del>Steve</del>");
    expect(report.html).toContain('<input type="checkbox" class="task-list-item-checkbox" disabled checked>');
    // at least one box is still unticked — the butter remains unstowed
    expect(report.html).toMatch(/checkbox" disabled>/);
  });
});

describe("ansi renderer", () => {
  test("output carries real SGR escape codes", () => {
    expect(report.ansi).toContain("\x1b[");
    expect(Bun.stripANSI(report.ansi)).not.toContain("\x1b[");
  });
});

describe("custom transcript renderer", () => {
  test("headings become transmission markers", () => {
    const plain = Bun.stripANSI(report.custom);
    expect(plain).toContain("◈ TRANSMISSION ::");
    expect(plain).toContain("◈ SEGMENT ::");
  });

  test("task checkboxes and code bursts survive the remap", () => {
    const plain = Bun.stripANSI(report.custom);
    expect(plain).toContain("▣ ");
    expect(plain).toContain("□ ");
    expect(plain).toContain("┌─ data burst");
    expect(plain).toContain("└─ end burst");
  });
});

describe("timings", () => {
  test("every renderer was actually measured", () => {
    expect(report.timings.htmlUs).toBeGreaterThan(0);
    expect(report.timings.ansiUs).toBeGreaterThan(0);
    expect(report.timings.customUs).toBeGreaterThan(0);
  });
});
