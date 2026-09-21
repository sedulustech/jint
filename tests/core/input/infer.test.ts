import { describe, test, expect } from "bun:test";
import {
  inferKind,
  looksLikeDiff,
  looksLikeRevShaped,
  resolveInput,
} from "../../../src/core/input/infer.ts";
import { AppError, type FileState } from "../../../src/core/types.ts";

describe("inferKind", () => {
  test("on-disk directory -> dir", async () => {
    expect(await inferKind("tests/fixtures/sample-dir")).toBe("dir");
  });

  test("on-disk file with diff-looking content -> diff", async () => {
    expect(await inferKind("tests/fixtures/sample.diff")).toBe("diff");
  });

  test("on-disk file, any other content -> file", async () => {
    expect(await inferKind("tests/fixtures/sample-file.ts")).toBe("file");
  });

  test("- -> diff (stdin, the primitive)", async () => {
    expect(await inferKind("-")).toBe("diff");
  });

  test("rev-looking non-path -> diff", async () => {
    expect(await inferKind("HEAD~2..HEAD")).toBe("diff");
    expect(await inferKind("HEAD")).toBe("diff");
    expect(await inferKind("9f2c1ab7e3d4a5b6c7d8e9f0a1b2c3d4e5f6a7b8")).toBe("diff");
    expect(await inferKind("origin/main")).toBe("diff");
  });

  test("missing non-rev input -> ENTRYPOINT_NOT_FOUND", async () => {
    try {
      await inferKind("definitely/not/here.ts");
      expect.unreachable();
    } catch (e) {
      expect((e as AppError).code).toBe("ENTRYPOINT_NOT_FOUND");
    }
  });
});

describe("looksLikeDiff", () => {
  test("git header (even after a commit-message preamble)", () => {
    expect(looksLikeDiff("commit abc\n\n    msg\n\ndiff --git a/x.ts b/x.ts\nindex..\n")).toBe(
      true,
    );
    expect(looksLikeDiff("diff --git a/x.ts b/x.ts\n")).toBe(true);
  });

  test("classic ---/+++ pair with hunks", () => {
    expect(looksLikeDiff("--- a/x.ts\n+++ b/x.ts\n@@ -1,2 +1,2 @@\n")).toBe(true);
  });

  test("plain source is not a diff", () => {
    expect(looksLikeDiff("export const x = 1;\n")).toBe(false);
    expect(looksLikeDiff("--- a note to self\n")).toBe(false);
  });
});

describe("looksLikeRevShaped", () => {
  test("ranges, HEAD, shas, upstream refs", () => {
    expect(looksLikeRevShaped("HEAD~2..HEAD")).toBe(true);
    expect(looksLikeRevShaped("HEAD")).toBe(true);
    expect(looksLikeRevShaped("9f2c1ab")).toBe(true);
    expect(looksLikeRevShaped("origin/main")).toBe(true);
    expect(looksLikeRevShaped("src/foo.ts")).toBe(false);
    expect(looksLikeRevShaped("-weird")).toBe(false);
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

  test("explicit file units carry { path, content } state", async () => {
    for await (const unit of resolveInput({ input: "tests/fixtures/sample-file.ts" })) {
      expect(Object.keys(unit.state).sort()).toEqual(["content", "path"]);
    }
  });

  test("diff-looking file content resolves to diff units", async () => {
    const paths: string[] = [];
    for await (const unit of resolveInput({ input: "tests/fixtures/sample.diff" })) {
      paths.push(unit.state.path);
      expect(unit.kind).toBe("diff");
    }
    expect(paths).toContain("src/tui/components/overlays/box.ts");
  });
});
