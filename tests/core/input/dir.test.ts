import { describe, test, expect } from "bun:test";
import { walkDir, parseGitignore, compilePattern } from "../../../src/core/input/dir.ts";

async function collect(root: string, exclude?: readonly string[]): Promise<string[]> {
  const paths: string[] = [];
  for await (const unit of walkDir(root, exclude)) paths.push(unit.state.path);
  return paths;
}

describe("walkDir", () => {
  test("excludes node_modules, .git, gitignored paths, and binaries by default", async () => {
    const paths = await collect("tests/fixtures/sample-dir");
    expect(paths).toContain("good.ts");
    expect(paths).toContain("sub/more.ts");
    expect(paths).not.toContain("ignored.ts"); // .gitignore
    expect(paths).not.toContain("node_modules/dep.js"); // default skip
    expect(paths).not.toContain("blob.bin"); // null-byte sniff
    expect(paths).not.toContain("photo.png"); // extension
  });

  test("file units carry { path, content } with paths relative to the root", async () => {
    for await (const unit of walkDir("tests/fixtures/sample-dir")) {
      expect(Object.keys(unit.state).sort()).toEqual(["content", "path"]);
      expect(unit.state.path.startsWith("tests/fixtures")).toBe(false);
    }
  });

  test("config exclude patterns prune on top of defaults", async () => {
    const paths = await collect("tests/fixtures/sample-dir", ["**/more.ts"]);
    expect(paths).toEqual(["good.ts"]);
  });

  test("missing directory -> ENTRYPOINT_NOT_FOUND", async () => {
    expect(collect("no/such/dir")).rejects.toThrow(/directory not found/);
  });

  test("a file passed as a directory -> ENTRYPOINT_NOT_FOUND", async () => {
    expect(collect("tests/fixtures/sample-file.ts")).rejects.toThrow(/not a directory/);
  });
});

describe("parseGitignore", () => {
  test("comments, blank lines, and negation", () => {
    const rules = parseGitignore("# comment\n\nbuild/\n!build/keep.ts\n");
    expect(rules).toHaveLength(2);
    expect(rules[0]!.dirOnly).toBe(true);
    expect(rules[1]!.negated).toBe(true);
  });
});

describe("compilePattern", () => {
  test("bare pattern matches at any depth", () => {
    const rule = compilePattern("node_modules");
    expect(rule.re.test("a/b/node_modules")).toBe(true);
    expect(rule.re.test("node_modules/x")).toBe(false);
  });

  test("glob patterns respect * vs **", () => {
    expect(compilePattern("**/more.ts").re.test("a/b/more.ts")).toBe(true);
    expect(compilePattern("*.ts").re.test("a/b/x.ts")).toBe(true);
    expect(compilePattern("src/*.ts").re.test("src/a/x.ts")).toBe(false);
    expect(compilePattern("src/*.ts").re.test("src/x.ts")).toBe(true);
  });
});
