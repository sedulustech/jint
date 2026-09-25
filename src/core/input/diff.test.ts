import { describe, test, expect } from "bun:test";
import { SetupError, type DiffState } from "../types.ts";
import { readDiffSource, decomposeDiff, splitDiffBlocks, parseDiffBlock } from "./diff.ts";

const COMMIT = "commit abc123\nAuthor: Someone\n\n    fix: the thing\n";
const GIT_DIFF = `${COMMIT}
diff --git a/src/a.ts b/src/a.ts
index 111..222 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,2 +1,3 @@
 context line
+added line
diff --git a/src/gone.ts b/src/gone.ts
deleted file mode 100644
index 333..000
--- a/src/gone.ts
+++ /dev/null
@@ -1 +0,0 @@
-removed
diff --git a/img/logo.png b/img/logo.png
index 444..555 100644
Binary files a/img/logo.png and b/img/logo.png differ
diff --git a/src/b.ts b/src/b.ts
index 666..777 100644
--- a/src/b.ts
+++ b/src/b.ts
@@ -1 +1 @@
-old
+new
`;

describe("splitDiffBlocks", () => {
  test("splits on git headers; preamble is its own block (later skipped)", () => {
    const elements = splitDiffBlocks(GIT_DIFF);
    const withHeaders = elements.filter((b) => b.startsWith("diff --git "));
    expect(withHeaders).toHaveLength(4);
  });

  test("git-less diffs split on ---/+++ pairs", () => {
    const classic =
      "--- a/x.ts\n+++ b/x.ts\n@@ -1 +1 @@\n-a\n+b\n--- a/y.ts\n+++ b/y.ts\n@@ -1 +1 @@\n-c\n+d\n";
    const elements = splitDiffBlocks(classic);
    expect(elements).toHaveLength(2);
    expect(elements[0]!).toContain("x.ts");
    expect(elements[1]!).toContain("y.ts");
  });

  test("git-format hunk bodies starting with --- stay intact", () => {
    const tricky =
      "diff --git a/x.ts b/x.ts\n--- a/x.ts\n+++ b/x.ts\n@@ -1 +1 @@\n--- --- weird\n+ok\ndiff --git a/y.ts b/y.ts\n--- a/y.ts\n+++ b/y.ts\n@@ -1 +1 @@\n+a\n";
    const elements = splitDiffBlocks(tricky);
    expect(elements.filter((b) => b.startsWith("diff --git"))).toHaveLength(2);
  });
});

describe("parseDiffBlock", () => {
  test("extracts target path from the +++ line", () => {
    const block = splitDiffBlocks(GIT_DIFF).find((b) => b.includes("b/src/a.ts"))!;
    const meta = parseDiffBlock(block)!;
    expect(meta.path).toBe("src/a.ts");
    expect(meta.deleted).toBe(false);
    expect(meta.binary).toBe(false);
  });

  test("marks deletions and binaries for skipping", () => {
    const deleted = splitDiffBlocks(GIT_DIFF).find((b) => b.includes("gone.ts"))!;
    expect(parseDiffBlock(deleted)!.deleted).toBe(true);
    const binary = splitDiffBlocks(GIT_DIFF).find((b) => b.includes("logo.png"))!;
    expect(parseDiffBlock(binary)!.binary).toBe(true);
  });

  test("unparseable block -> null", () => {
    expect(parseDiffBlock("random prose\nnothing here")).toBeNull();
  });
});

describe("decomposeDiff", () => {
  test("per-file units; deleted and binary skipped; commit message shared", () => {
    const units = [...decomposeDiff(GIT_DIFF, "fix: the thing", [])];
    expect(units.map((u) => u.state.path)).toEqual(["src/a.ts", "src/b.ts"]);
    expect(units.every((u) => u.kind === "diff")).toBe(true);
    for (const unit of units) {
      expect(Object.keys(unit.state).sort()).toEqual(["commit_message", "diff", "path"]);
      expect((unit.state as DiffState).commit_message).toBe("fix: the thing");
    }
  });

  test("exclude patterns drop units by path", () => {
    const units = [...decomposeDiff(GIT_DIFF, null, ["**/b.ts"])];
    expect(units.map((u) => u.state.path)).toEqual(["src/a.ts"]);
  });

  test("diff state keeps the calibrated shape", () => {
    const [unit] = [...decomposeDiff(GIT_DIFF, null, [])];
    expect((unit!.state as DiffState).diff).toContain("@@ -1,2 +1,3 @@");
    expect((unit!.state as DiffState).diff.startsWith("diff --git a/src/a.ts")).toBe(true);
  });
});

describe("readDiffSource", () => {
  test("on-disk patch file is read verbatim", async () => {
    const source = await readDiffSource("tests/fixtures/sample.diff");
    expect(source.text).toContain("diff --git a/src/tui/components/overlays/box.ts");
    expect(source.commitMessage).toBeNull();
  });

  test("rev-shaped input is not a diff source (jint never shells to git)", async () => {
    try {
      await readDiffSource("HEAD~2..HEAD");
      expect.unreachable();
    } catch (e) {
      expect((e as SetupError).code).toBe("ENTRYPOINT_NOT_FOUND");
      expect((e as SetupError).message).toContain("jint diff -");
    }
  });
});
