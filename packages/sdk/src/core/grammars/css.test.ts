/** The css port: comments are the only honest capture; everything else waits (queries.scm). */
import { describe, expect, test } from "bun:test";
import { decompose } from "./walk.ts";

describe("decompose — css", () => {
  test("comments are the only elements; rules and declarations passthrough", async () => {
    const inv = await decompose(
      "/* header */\n.card { color: red; /* why */ }\n@media print { .x { a: b; } }\n",
      "css",
    );
    // With no captured definitions there is nothing to contain a comment: the "trailing note"
    // inside a rule body stands alone (the reference walker counted it internal to the stretched
    // rule_set element - absence policy makes it an element instead).
    expect(inv.comments.map((c) => c.content)).toEqual(["/* header */", "/* why */"]);
    expect(inv.definitions).toEqual([]);
    expect(inv.imports).toEqual([]);
  });

  test("a stylesheet with no comments yields zero elements - legal per grammar", async () => {
    const inv = await decompose(".card { color: red; }\n", "css");
    expect([...inv.definitions, ...inv.comments, ...inv.imports]).toEqual([]);
  });
});
