import { describe, test, expect } from "bun:test";
import { ClassifyError, InternalError, SetupError, lint, type ClassifyErrorCode } from "@jint/sdk";
import { Value as TypeBoxValue } from "@sinclair/typebox/value";
import { defaultConfig } from "./baseline.ts";
import {
  CLI_ARGS_SCHEMA,
  emit,
  exitForThrown,
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

/**
 * The emitter: the one writer of the `jint: ` prefix, and exitForThrown's type-driven codes with
 * detail rendering. Every shape the CLI can print for a thrown error is pinned here.
 */
describe("cli: the stderr emitter and thrown-error shapes", () => {
  /** Capture emit's stderr for one call. */
  function capture(run: () => void): string {
    const chunks: string[] = [];
    const original = process.stderr.write;
    process.stderr.write = ((chunk: string | Uint8Array) => {
      chunks.push(String(chunk));
      return true;
    }) as typeof process.stderr.write;
    try {
      run();
    } finally {
      process.stderr.write = original;
    }
    return chunks.join("");
  }

  test("unknown-rule detail: message leads, origin label rides the message, code trails", () => {
    const error = new SetupError("CONFIG_INVALID", 'unknown rule "not_a_rule"', {
      detail: {
        kind: "unknown-rule",
        valid: ["alpha", "beta", "gamma"],
        suggest: "alpha",
      },
    });
    let code = 0;
    const line = capture(() => {
      code = exitForThrown(error, "(--rule)");
    });
    expect(line).toBe(
      'jint: unknown rule "not_a_rule" (--rule) - valid: alpha, beta, gamma - did you mean: alpha [CONFIG_INVALID]\n',
    );
    expect(code).toBe(2);
  });

  test("no close match: no did-you-mean segment (a missing suggestion is legitimate)", () => {
    const line = capture(() =>
      exitForThrown(
        new SetupError("CONFIG_INVALID", 'unknown rule "not_a_rule"', {
          detail: { kind: "unknown-rule", valid: ["alpha", "beta"] },
        }),
      ),
    );
    expect(line).toBe('jint: unknown rule "not_a_rule" - valid: alpha, beta [CONFIG_INVALID]\n');
  });

  test("config origin: no flag label", () => {
    const line = capture(() =>
      exitForThrown(
        new SetupError("CONFIG_INVALID", 'unknown rule "x"', {
          detail: { kind: "unknown-rule", valid: ["alpha"] },
        }),
      ),
    );
    expect(line).toBe('jint: unknown rule "x" - valid: alpha [CONFIG_INVALID]\n');
  });

  test("unknown-language detail: the valid list, capped at six with ... only when cut", () => {
    const eight = ["a", "b", "c", "d", "e", "f", "g", "h"];
    const cut = capture(() =>
      exitForThrown(
        new SetupError("MISSING_GRAMMAR", "unknown extension, missing grammar", {
          detail: { kind: "unknown-language", valid: eight },
        }),
      ),
    );
    expect(cut).toBe(
      "jint: unknown extension, missing grammar - valid: a, b, c, d, e, f ... [MISSING_GRAMMAR]\n",
    );
    const exact = capture(() =>
      exitForThrown(
        new SetupError("MISSING_GRAMMAR", "unknown extension, missing grammar", {
          detail: { kind: "unknown-language", valid: eight.slice(0, 6) },
        }),
      ),
    );
    expect(exact).toBe(
      "jint: unknown extension, missing grammar - valid: a, b, c, d, e, f [MISSING_GRAMMAR]\n",
    );
  });

  test("invalid-rule detail replaces the schema prose with the rule-and-field line", () => {
    let code = 0;
    const line = capture(() => {
      code = exitForThrown(
        new SetupError(
          "CONFIG_INVALID",
          "invalid config x.json: /rules/0/instructions Expected string",
          {
            detail: { kind: "invalid-rule", ruleIndex: 0, field: "instructions" },
          },
        ),
      );
    });
    expect(line).toBe(
      'jint: invalid rule #0: missing "instructions" - see the config example in README [CONFIG_INVALID]\n',
    );
    expect(code).toBe(2);
  });

  test("internal voice: the bug bucket says so, names the remedy, exits 3", () => {
    let code = 0;
    const line = capture(() => {
      code = exitForThrown(new InternalError("score 9 is outside the criteria scale 0..2"));
    });
    expect(line).toBe(
      "jint: internal: score 9 is outside the criteria scale 0..2 - rerun with --debug; if it persists, report it [INTERNAL]\n",
    );
    expect(code).toBe(3);
  });

  test("an unknown-shaped throw wraps into InternalError (exit 3, internal voice)", () => {
    let code = 0;
    const line = capture(() => {
      code = exitForThrown(new TypeError("cannot read properties of undefined"));
    });
    expect(line).toContain(
      "jint: internal: cannot read properties of undefined - rerun with --debug",
    );
    expect(code).toBe(3);
  });

  test("an escaped ClassifyError exits 4 (the run happened but produced nothing usable)", () => {
    let code = 0;
    const line = capture(() => {
      code = exitForThrown(
        new ClassifyError("JEV_TIMEOUT" as ClassifyErrorCode, "str:stdin", "timed out"),
      );
    });
    expect(line).toBe("jint: timed out [JEV_TIMEOUT]\n");
    expect(code).toBe(4);
  });

  test("a detail-less SetupError renders message + trailing code, exit 2", () => {
    const line = capture(() =>
      exitForThrown(new SetupError("ENTRYPOINT_NOT_FOUND", "input not found: src/")),
    );
    expect(line).toBe("jint: input not found: src/ [ENTRYPOINT_NOT_FOUND]\n");
  });

  test("emit kinds: note adds its voice word; plain and info render bare", () => {
    expect(capture(() => emit({ message: "oversized skipped", kind: "note" }))).toBe(
      "jint: note: oversized skipped\n",
    );
    expect(capture(() => emit({ message: "ui -> http://localhost:1" }))).toBe(
      "jint: ui -> http://localhost:1\n",
    );
    expect(capture(() => emit({ message: "jev backoff: retrying in 5ms", kind: "info" }))).toBe(
      "jint: jev backoff: retrying in 5ms\n",
    );
  });
});
