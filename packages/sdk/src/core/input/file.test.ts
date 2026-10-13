import { describe, test, expect } from "bun:test";
import { SetupError } from "../types.ts";
import { fileUnit } from "./file.ts";
import { knownLanguages } from "./walk.ts";

describe("fileUnit (explicit --file path)", () => {
  test("file with no grammar -> MISSING_GRAMMAR setup error, not silence", async () => {
    const thrown = await fileUnit("tests/fixtures/sample-dir/data.json").then(
      () => null,
      (e) => e,
    );
    expect(thrown).toBeInstanceOf(SetupError);
    expect(thrown.code).toBe("MISSING_GRAMMAR");
  });

  test("a Makefile (extensionless) -> MISSING_GRAMMAR, detail carries the valid languages", async () => {
    const thrown = await fileUnit("tests/fixtures/sample-dir/Makefile").then(
      () => null,
      (e) => e,
    );
    expect(thrown).toBeInstanceOf(SetupError);
    expect(thrown.code).toBe("MISSING_GRAMMAR");
    expect(thrown.detail).toEqual({ kind: "unknown-language", valid: knownLanguages() });
  });

  test("source file still yields a unit", async () => {
    const unit = await fileUnit("tests/fixtures/sample-dir/good.ts");
    expect(unit.kind).toBe("file");
  });
});
