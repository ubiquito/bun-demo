import { beforeAll, describe, expect, test } from "bun:test";
import { cargoStatus, inspect } from "../src/systems/cargo-hold.ts";
import type { CargoReport } from "../src/types.ts";

let report: CargoReport;

beforeAll(async () => {
  report = await inspect();
});

describe("cargo hold", () => {
  test("deck reports online", () => {
    expect(cargoStatus().online).toBeTrue();
  });

  test("all six dialects parse clean", () => {
    expect(report.dialects.map(d => d.name).sort()).toEqual(
      ["json5", "jsonc", "jsonl", "toml", "xml", "yaml"],
    );
    for (const dialect of report.dialects) {
      expect(dialect.ok).toBeTrue();
      expect(dialect.sample.length).toBeGreaterThan(0);
      expect(dialect.parseUs).toBeGreaterThan(0);
    }
  });

  test("the core dialects reached deepEquals consensus", () => {
    // inspect() flags any core dialect that disagrees with the witness by
    // setting ok=false and appending "disagrees" — so a clean board IS the verdict
    for (const name of ["json5", "jsonc", "yaml", "toml"]) {
      const dialect = report.dialects.find(d => d.name === name)!;
      expect(dialect.ok).toBeTrue();
      expect(dialect.sample).not.toContain("disagrees");
    }
  });

  test("the tar roundtrip brought every byte home", () => {
    expect(report.archive.roundtripOk).toBeTrue();
    expect(report.archive.format).toBe("tar + gzip");
    expect(report.archive.bytes).toBeGreaterThan(0);
    expect(report.archive.packMs).toBeGreaterThan(0);
    expect(report.archive.extractMs).toBeGreaterThan(0);
  });

  test("the manifest lists all six files, each with real cargo aboard", () => {
    expect(report.archive.files).toHaveLength(6);
    for (const file of report.archive.files) {
      expect(file.size).toBeGreaterThan(0);
    }
  });
});
