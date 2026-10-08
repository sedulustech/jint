import { describe, test, expect } from "bun:test";
import { SetupError } from "../types.ts";
import { fileUnit } from "./file.ts";

describe("fileUnit (explicit --file path)", () => {
  test("file with no grammar -> MISSING_GRAMMAR setup error, not silence", async () => {
    const thrown = await fileUnit("tests/fixtures/sample-dir/data.json").then(
      () => null,
      (e) => e,
    );
    expect(thrown).toBeInstanceOf(SetupError);
    expect(thrown.code).toBe("MISSING_GRAMMAR");
  });

  test("a Makefile (extensionless) -> MISSING_GRAMMAR naming the supported grammars", async () => {
    await expect(fileUnit("tests/fixtures/sample-dir/Makefile")).rejects.toThrow(
      /missing grammar - supported grammars: ts, tsx, py, go/,
    );
  });

  test("source file still yields a unit", async () => {
    const unit = await fileUnit("tests/fixtures/sample-dir/good.ts");
    expect(unit.kind).toBe("file");
  });
});
