import { describe, test, expect } from "bun:test";
import { SetupError } from "../types.ts";
import { fileUnit } from "./file.ts";

describe("fileUnit (explicit --file path)", () => {
  test("non-source file -> NOT_SOURCE setup error, not silence", async () => {
    const thrown = await fileUnit("tests/fixtures/sample-dir/data.json").then(
      () => null,
      (e) => e,
    );
    expect(thrown).toBeInstanceOf(SetupError);
    expect(thrown.code).toBe("NOT_SOURCE");
  });

  test("extensionless file (Makefile) -> NOT_SOURCE, same door as --language hint", async () => {
    await expect(fileUnit("tests/fixtures/sample-dir/Makefile")).rejects.toThrow(
      /not classifiable/,
    );
  });

  test("source file still yields a unit", async () => {
    const unit = await fileUnit("tests/fixtures/sample-dir/good.ts");
    expect(unit.kind).toBe("file");
  });
});
