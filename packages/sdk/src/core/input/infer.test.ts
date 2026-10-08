import { describe, test, expect } from "bun:test";
import { SetupError, type FileState } from "../types.ts";
import { inferKind, resolveInput } from "./infer.ts";

describe("inferKind", () => {
  test("on-disk directory -> dir", async () => {
    expect(await inferKind("tests/fixtures/sample-dir")).toBe("dir");
  });

  test("on-disk file with diff-looking content -> FILE (no content sniffing)", async () => {
    expect(await inferKind("tests/fixtures/sample.diff")).toBe("file");
  });

  test("on-disk file, any other content -> file", async () => {
    expect(await inferKind("tests/fixtures/sample-file.ts")).toBe("file");
  });

  test("- is not inferred as anything (no path, no sniffing) -> ENTRYPOINT_NOT_FOUND", async () => {
    try {
      await inferKind("-");
      expect.unreachable();
    } catch (e) {
      expect((e as SetupError).code).toBe("ENTRYPOINT_NOT_FOUND");
    }
  });

  test("rev-shaped non-path -> ENTRYPOINT_NOT_FOUND (jint never shells to git)", async () => {
    for (const rev of [
      "HEAD~2..HEAD",
      "HEAD",
      "9f2c1ab7e3d4a5b6c7d8e9f0a1b2c3d4e5f6a7b8",
      "origin/main",
    ]) {
      try {
        await inferKind(rev);
        expect.unreachable();
      } catch (e) {
        expect((e as SetupError).code).toBe("ENTRYPOINT_NOT_FOUND");
      }
    }
  });

  test("missing non-rev input -> ENTRYPOINT_NOT_FOUND", async () => {
    try {
      await inferKind("definitely/not/here.ts");
      expect.unreachable();
    } catch (e) {
      expect((e as SetupError).code).toBe("ENTRYPOINT_NOT_FOUND");
    }
  });
});

describe("resolveInput", () => {
  test("array input resolves each explicit file in order", async () => {
    const units: string[] = [];
    for await (const unit of resolveInput({
      input: ["tests/fixtures/sample-file.ts", "tests/fixtures/sample-dir/good.ts"],
    })) {
      units.push(unit.state.path);
      expect(unit.kind).toBe("file");
      if (unit.kind === "file") expect((unit.state as FileState).content.length).toBeGreaterThan(0);
    }
    expect(units).toEqual(["tests/fixtures/sample-file.ts", "tests/fixtures/sample-dir/good.ts"]);
  });

  test("explicit file units carry { path, content, id } state", async () => {
    for await (const unit of resolveInput({ input: "tests/fixtures/sample-file.ts" })) {
      expect(Object.keys(unit.state).sort()).toEqual(["content", "id", "path"]);
    }
  });

  test("diff-looking file resolves by FILE semantics (kind is never sniffed)", async () => {
    // resolveInput goes down the file path: fileUnit rejects the .diff extension as non-source.
    // A diff decomposition would have yielded per-file units instead of throwing MISSING_GRAMMAR.
    try {
      for await (const _ of resolveInput({ input: "tests/fixtures/sample.diff" })) {
        expect.unreachable();
      }
    } catch (e) {
      expect((e as SetupError).code).toBe("MISSING_GRAMMAR");
    }
  });

  test("a patch file is just a file: MISSING_GRAMMAR (no diff noun, no diff inputType) (no diff noun, no diff inputType)", async () => {
    try {
      for await (const _ of resolveInput({ input: "tests/fixtures/sample.diff" })) {
        expect.unreachable();
      }
    } catch (e) {
      expect((e as SetupError).code).toBe("MISSING_GRAMMAR");
    }
  });
});
