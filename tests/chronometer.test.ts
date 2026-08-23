import { describe, expect, test } from "bun:test";
import { chronometerStatus, windows } from "../src/systems/chronometer.ts";

// A fixed launch instant, so the direct Bun.cron.parse assertions never
// depend on when (or where) this suite runs: 2026-01-01 00:07:00 UTC.
const T0 = Date.UTC(2026, 0, 1, 0, 7, 0);

const hourIn = (d: Date, tz: string) =>
  Number(new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", hour12: false }).format(d));

describe("chronometer deck", () => {
  test("reports online", () => {
    expect(chronometerStatus().online).toBeTrue();
  });
});

describe("windows()", () => {
  test("*/15 charts five strictly-increasing quarter-hour boundaries", () => {
    const report = windows("*/15 * * * *", 5);
    expect(report.valid).toBeTrue();
    expect(report.next).toHaveLength(5);
    let prev = Date.now();
    for (const iso of report.next) {
      const d = new Date(iso);
      expect(iso).toBe(d.toISOString());
      expect(d.getTime()).toBeGreaterThan(prev);
      expect(d.getMinutes() % 15).toBe(0);
      expect(d.getSeconds()).toBe(0);
      prev = d.getTime();
    }
  });

  test("an out-of-range field comes back calm: valid false, error set, nothing thrown", () => {
    const report = windows("61 * * * *");
    expect(report.valid).toBeFalse();
    expect(report.error).toBeString();
    expect(report.error!.length).toBeGreaterThan(0);
    expect(report.next).toEqual([]);
  });

  test("gibberish is refused just as gently", () => {
    expect(windows("every full moon").valid).toBeFalse();
  });

  test("@daily nickname resolves to a midnight", () => {
    const report = windows("@daily", 2);
    expect(report.valid).toBeTrue();
    expect(report.next).toHaveLength(2);
    for (const iso of report.next) {
      const d = new Date(iso);
      expect(d.getHours()).toBe(0);
      expect(d.getMinutes()).toBe(0);
    }
  });

  test("jobs listing is present (and empty here — nothing armed in tests)", () => {
    expect(windows("* * * * *").jobs).toEqual([]);
  });
});

describe("Bun.cron.parse with a pinned relativeDate", () => {
  test("*/15 from 00:07 UTC lands on 00:15 UTC exactly", () => {
    const hit = Bun.cron.parse("*/15 * * * *", T0, { tz: "UTC" });
    expect(hit?.toISOString()).toBe("2026-01-01T00:15:00.000Z");
  });

  test("@daily from a pinned instant lands on the next UTC midnight", () => {
    const hit = Bun.cron.parse("@daily", T0, { tz: "UTC" });
    expect(hit?.toISOString()).toBe("2026-01-02T00:00:00.000Z");
  });

  test("9am in Tokyo and 9am in New York are different instants, each 9am at home", () => {
    const tokyo = Bun.cron.parse("0 9 * * *", T0, { tz: "Asia/Tokyo" })!;
    const ny = Bun.cron.parse("0 9 * * *", T0, { tz: "America/New_York" })!;
    expect(tokyo.getTime()).not.toBe(ny.getTime());
    expect(hourIn(tokyo, "Asia/Tokyo")).toBe(9);
    expect(hourIn(ny, "America/New_York")).toBe(9);
  });
});
