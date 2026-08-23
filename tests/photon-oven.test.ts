import { beforeAll, describe, expect, test } from "bun:test";
import { bake, ovenStatus } from "../src/systems/photon-oven.ts";
import type { BakeReport } from "../src/types.ts";

// 128 px keeps the whole pipeline warm but quick; bake() also runs the
// procedural nebula generator implicitly when assets/nebula.png is missing.
let report: BakeReport;

beforeAll(async () => {
  report = await bake(128);
}, 30_000);

describe("photon oven", () => {
  test("deck reports online", () => {
    expect(ovenStatus().online).toBeTrue();
  });

  test("the source nebula is a real PNG with real dimensions", () => {
    expect(report.source.format).toBe("png");
    expect(report.source.width).toBeGreaterThan(0);
    expect(report.source.height).toBeGreaterThan(0);
    expect(report.source.bytes).toBeGreaterThan(0);
  });

  test("the rack is full and every asset weighs something", () => {
    expect(report.outputs.length).toBeGreaterThan(0);
    for (const asset of report.outputs) {
      expect(asset.bytes).toBeGreaterThan(0);
      expect(asset.ms).toBeGreaterThan(0);
      expect(asset.name.length).toBeGreaterThan(0);
    }
  });

  test("every resized output fits inside 128 px", () => {
    // everything except the header-only metadata() entry goes through resize
    const resized = report.outputs.filter(a => !a.op.startsWith("metadata"));
    expect(resized.length).toBeGreaterThan(0);
    for (const asset of resized) {
      expect(asset.width).toBeLessThanOrEqual(128);
      expect(asset.height).toBeLessThanOrEqual(128);
    }
  });

  test("placeholder is an inline-able data URL", () => {
    expect(report.placeholder).toStartWith("data:image/");
    expect(report.placeholder.length).toBeLessThan(2048);
  });

  test("the whole bake was timed for real", () => {
    expect(report.totalMs).toBeGreaterThan(0);
  });
});
