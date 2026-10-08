import { describe, test, expect } from "bun:test";
import { lint } from "@jint/sdk";
import { Value as TypeBoxValue } from "@sinclair/typebox/value";
import { defaultConfig } from "./baseline.ts";
import {
  CLI_ARGS_SCHEMA,
  FLAGS,
  HELP,
  KNOWN_FLAGS,
  parseFileSelector,
  splitArgv,
  VALUED_FLAGS,
} from "./cli.ts";

describe("cli: in-process unit tests", () => {
  test("config disable: is_vocabulary_consistent not called", async () => {
    const config = { ...defaultConfig(), input: "tests/fixtures/sample-file.ts" };
    const asked: string[] = [];
    const fakeJudge = async (state: any, _questions: any) => {
      Object.keys(_questions ?? {}).forEach((k) => asked.push(k));
      return {
        is_vocabulary_consistent: 0.9,
        is_name_purposeful: 0.9,
        is_greppable: 0.9,
        is_comment_narration: 0.1,
        is_comment_patching_readability: 0.1,
        will_comment_drift: 0.1,
        is_cognitively_complex: 0.1,
      };
    };

    const stream = lint({
      config,
      disable: ["is_vocabulary_consistent"],
      classifier: fakeJudge as any,
    });
    for await (const _ of stream) {
      // drained
    }
    expect(asked).not.toContain("is_vocabulary_consistent");
  });

  test("exclude propagation: path excluded not called", async () => {
    const config = { ...defaultConfig(), input: "tests/fixtures/sample-dir" };
    const asked: string[] = [];
    const fakeJudge = async (state: any, _questions: any) => {
      asked.push(state.path);
      return {
        is_vocabulary_consistent: 0.9,
        is_name_purposeful: 0.9,
        is_greppable: 0.9,
        is_comment_narration: 0.1,
        is_comment_patching_readability: 0.1,
        will_comment_drift: 0.1,
        is_cognitively_complex: 0.1,
      };
    };

    // tests/fixtures/sample-dir/good.ts
    const stream = lint({
      config,
      exclude: ["**/good.ts"],
      classifier: fakeJudge as any,
    });
    for await (const _ of stream) {
      // drained
    }
    expect(asked.some((p) => p.endsWith("good.ts"))).toBe(false);
  });
});

describe("parseFileSelector - LOC element selectors on file nouns", () => {
  test("bare path: no selector", () => {
    expect(parseFileSelector("src/a.ts")).toEqual({ path: "src/a.ts" });
  });

  test("@L58: anchor", () => {
    const r = parseFileSelector("src/a.ts@L58");
    expect(r.path).toBe("src/a.ts");
    expect(r.anchor).toBe(58);
    expect(r.ranges).toBeUndefined();
  });

  test("@L58-L90: one range; comma list tolerates spaces", () => {
    expect(parseFileSelector("a.ts@L58-L90").ranges).toEqual([{ start: 58, end: 90 }]);
    expect(parseFileSelector("a.ts@L58-L90, @L1-L8").ranges).toEqual([
      { start: 58, end: 90 },
      { start: 1, end: 8 },
    ]);
  });

  test("invalid spans are badRange markers (usage error), never paths", () => {
    expect(parseFileSelector("a.ts@L90-L58").badRange).toBe("L90-L58");
    expect(parseFileSelector("a.ts@Lx").badRange).toBe("Lx");
    expect(parseFileSelector("a.ts@L58-").badRange).toBe("L58-");
    expect(parseFileSelector("a.ts@L58-L90x").badRange).toBe("L58-L90x");
  });

  test("a uuid-shaped #id stem is a pasted artifact, not a selector", () => {
    expect(parseFileSelector("server.ts#f1c044af-a09f-43d8-8460-c87213766c47").pastedId).toBe(true);
    expect(parseFileSelector("server.ts#f1c044af-a09f-43d8-8460-c87213766c47@L58").pastedId).toBe(
      true,
    );
  });

  test("non-uuid suffix after hash stays a path (no selector)", () => {
    expect(parseFileSelector("weird#name.ts").path).toBe("weird#name.ts");
    expect(parseFileSelector("a.ts#abc@L5").path).toBe("a.ts#abc");
  });
});

describe("FLAGS — the one flag table, everything else derived", () => {
  test("KNOWN_FLAGS is exactly the table's names plus its single-char aliases", () => {
    const expected = [
      ...Object.keys(FLAGS),
      ...Object.values(FLAGS).flatMap((flag) => ("aliases" in flag ? [...flag.aliases] : [])),
    ].sort();
    expect([...KNOWN_FLAGS].sort()).toEqual(expected);
  });

  test("VALUED_FLAGS is exactly the table's value-taking flags (type !== boolean)", () => {
    const expected = Object.entries(FLAGS)
      .filter(([, flag]) => flag.type !== "boolean")
      .map(([name]) => name)
      .sort();
    expect([...VALUED_FLAGS].sort()).toEqual(expected);
  });

  test("HELP names every flag in the table (the Options section is derived, not hand-written)", () => {
    for (const name of Object.keys(FLAGS)) expect(HELP).toContain(name);
    for (const flag of Object.values(FLAGS)) {
      if ("aliases" in flag) expect(HELP).toContain(flag.aliases[0]);
    }
  });

  test("the TypeBox schema accepts exactly the table's value shapes", () => {
    expect(TypeBoxValue.Check(CLI_ARGS_SCHEMA, { rule: ["a", "b"] })).toBe(true);
    expect(TypeBoxValue.Check(CLI_ARGS_SCHEMA, { rule: "a" })).toBe(false);
    expect(TypeBoxValue.Check(CLI_ARGS_SCHEMA, { json: true })).toBe(true);
    expect(TypeBoxValue.Check(CLI_ARGS_SCHEMA, { json: "yes" })).toBe(false);
    expect(TypeBoxValue.Check(CLI_ARGS_SCHEMA, { language: "go" })).toBe(true);
  });

  test("valued flags consume their next token and accumulate; boolean flags never do", () => {
    expect(splitArgv(["--rule", "a", "--rule", "b", "src/"])).toEqual({
      flagArgs: ["--rule", "a", "--rule", "b"],
      positionals: ["src/"],
    });
    expect(splitArgv(["--json", "str", "-"])).toEqual({
      flagArgs: ["--json"],
      positionals: ["str", "-"],
    });
  });
});
