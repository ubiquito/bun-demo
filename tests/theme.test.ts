import { describe, expect, test } from "bun:test";
import { fmt, gauge } from "../src/lib/theme.ts";

describe("fmt.ms", () => {
  test("sub-millisecond readings drop to microseconds", () => {
    expect(fmt.ms(0.5)).toBe("500 µs");
    expect(fmt.ms(0.999)).toBe("999 µs");
    expect(fmt.ms(0)).toBe("0 µs");
  });

  test("single-digit milliseconds keep two decimals", () => {
    expect(fmt.ms(1)).toBe("1.00 ms");
    expect(fmt.ms(9.994)).toBe("9.99 ms");
  });

  test("double- and triple-digit milliseconds keep one decimal", () => {
    expect(fmt.ms(10)).toBe("10.0 ms");
    expect(fmt.ms(999.94)).toBe("999.9 ms");
  });

  test("a full second promotes to seconds", () => {
    expect(fmt.ms(1000)).toBe("1.00 s");
    expect(fmt.ms(61_500)).toBe("61.50 s");
  });
});

describe("fmt.us", () => {
  test("stays in microseconds below one millisecond", () => {
    expect(fmt.us(0.4)).toBe("0.4 µs");
    expect(fmt.us(999.9)).toBe("999.9 µs");
  });

  test("hands off to fmt.ms at exactly 1000 µs", () => {
    expect(fmt.us(1000)).toBe("1.00 ms");
    expect(fmt.us(2_500_000)).toBe("2.50 s");
  });
});

describe("fmt.bytes", () => {
  test("bytes, up to the last whole byte before a kilobyte", () => {
    expect(fmt.bytes(0)).toBe("0 B");
    expect(fmt.bytes(1023)).toBe("1023 B");
  });

  test("kilobytes with one decimal", () => {
    expect(fmt.bytes(1024)).toBe("1.0 KB");
    expect(fmt.bytes(1536)).toBe("1.5 KB");
    expect(fmt.bytes(1024 ** 2 - 1)).toBe("1024.0 KB");
  });

  test("megabytes with two decimals", () => {
    expect(fmt.bytes(1024 ** 2)).toBe("1.00 MB");
    expect(fmt.bytes(5.25 * 1024 ** 2)).toBe("5.25 MB");
  });
});

describe("fmt.int", () => {
  test("rounds and adds thousands separators", () => {
    expect(fmt.int(1_400_000)).toBe("1,400,000");
    expect(fmt.int(2.6)).toBe("3");
    expect(fmt.int(0)).toBe("0");
  });
});

describe("gauge", () => {
  // the same width the gauge itself computes, whatever terminal we run in
  const gaugeWidth = () => Math.min(process.stdout.columns || 72, 72);

  test("stripped line lands exactly on the gauge width", () => {
    const line = Bun.stripANSI(gauge("oven temperature", "228 °C"));
    expect(Bun.stringWidth(line)).toBe(gaugeWidth());
  });

  test("dot leader bridges label and value", () => {
    const line = Bun.stripANSI(gauge("buns", "1,400,000"));
    expect(line).toStartWith("  buns ");
    expect(line).toEndWith(" 1,400,000");
    expect(line).toContain("···");
  });

  test("an oversized label still yields at least one dot, never a negative repeat", () => {
    const label = "x".repeat(200);
    const line = Bun.stripANSI(gauge(label, "ok"));
    expect(line).toContain("·");
    expect(Bun.stringWidth(line)).toBeGreaterThanOrEqual(gaugeWidth());
  });
});
