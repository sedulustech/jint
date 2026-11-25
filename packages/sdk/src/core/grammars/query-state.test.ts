import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolveAllCustomTargets, runCustomRules } from "../rules/custom/execute.ts";
import { validateCustomRule, type CustomElement } from "../rules/custom/schema.ts";
import { EMBEDDED, parserFor } from "./grammars.ts";
import { decompose } from "./walk.ts";
import type { AnyState, Classifier } from "../types.ts";

/**
 * A rule's state reads a query file one level at a time: a definition holds its nodes, a node holds
 * its captures and the nodes inside it, a field holds its node. Each capture's name sits next to
 * the type of the node it marks, with no text to parse. The classifier here only records the
 * state.
 */

interface Read {
  /** The node's type; absent for an alternation or a grouping. */
  readonly type: string | undefined;
  readonly captures: readonly string[];
  readonly nodes: readonly Read[];
}

function readNode(node: CustomElement): Read {
  const inside = [
    ...node.getElements("query:node"),
    ...node.getElements("query:field").flatMap((field) => field.getElements("query:node")),
  ];
  return {
    type: node.name,
    captures: node.getElements("query:capture").map((capture) => capture.name!),
    nodes: inside.map(readNode),
  };
}

async function patternsOf(source: string): Promise<Read[][]> {
  const states: AnyState[] = [];
  const classifier: Classifier = async (state) => {
    states.push(JSON.parse(JSON.stringify(state)) as AnyState);
    return { is_rule: { value: 0.1 } };
  };
  const rule = validateCustomRule(
    {
      name: "is_rule",
      handle: { warn: { greater_than: 0.5 } },
      instructions: "i",
      criteria: { true: "t", false: "f" },
      target: "query:definition",
      state: (definition: CustomElement) => ({
        nodes: definition.getElements("query:node").map(readNode),
      }),
    },
    "jint.config.ts",
  );
  const inv = await decompose(source, "query");
  const inventory = new Map([["f", [...inv.definitions, ...inv.comments, ...inv.imports]]]);
  const resolved = resolveAllCustomTargets([rule], inventory, undefined, EMBEDDED);
  const { events } = await runCustomRules([rule], resolved, classifier, () => false);
  expect(events.filter((e) => e.type === "error")).toEqual([]);
  return states.map((s) => (s as unknown as { nodes: Read[] }).nodes);
}

const total = (nodes: readonly Read[]): { nodes: number; captures: number } =>
  nodes.reduce(
    (sum, n) => {
      const inner = total(n.nodes);
      return {
        nodes: sum.nodes + 1 + inner.nodes,
        captures: sum.captures + n.captures.length + inner.captures,
      };
    },
    { nodes: 0, captures: 0 },
  );

describe("a rule's state over a queries.scm file", () => {
  test("each capture's name is read beside the type of its node", async () => {
    const [pattern] = await patternsOf(
      "(block_mapping_pair key: (_) @key value: (_)? @value) @pair\n",
    );
    expect(pattern).toEqual([
      {
        type: "block_mapping_pair",
        captures: ["pair"],
        nodes: [
          { type: "_", captures: ["key"], nodes: [] },
          { type: "_", captures: ["value"], nodes: [] },
        ],
      },
    ]);
  });

  test("an alternation has captures and no type, and a quoted node is its text", async () => {
    const patterns = await patternsOf('[(a) "b"]+ @alt\n"=" @operator\n');
    expect(patterns).toEqual([
      [
        {
          type: undefined,
          captures: ["alt"],
          nodes: [
            { type: "a", captures: [], nodes: [] },
            { type: "b", captures: [], nodes: [] },
          ],
        },
      ],
      [{ type: "=", captures: ["operator"], nodes: [] }],
    ]);
  });

  test("a capture named in a predicate marks no node", async () => {
    const patterns = await patternsOf('((a) @x (#eq? @x "v"))\n(#set! "k" @x)\n');
    expect(patterns).toHaveLength(1);
    expect(total(patterns[0]!)).toEqual({ nodes: 2, captures: 1 });
  });

  // every tracked .scm file, read with no model call: the captures the state finds are the captures
  // that sit on a node in the parse tree
  const FILES = [
    ...Object.keys(EMBEDDED).map((id) => `embedded/${id}/queries.scm`),
    "../../../../../tests/fixtures/grammars/markdown/queries.scm",
  ];
  test.each(FILES)("%s: the state finds every pattern and every capture", async (file) => {
    const source = readFileSync(new URL(file, import.meta.url), "utf8");
    const tree = (await parserFor(EMBEDDED.query!)).parse(source)!;
    const root = tree.rootNode;
    const wantPatterns = root.namedChildren.filter(
      (n) => n.type !== "comment" && n.type !== "predicate",
    );
    const wantCaptures = root
      .descendantsOfType("capture")
      .filter((n) => n.parent?.type !== "parameters");
    const patterns = await patternsOf(source);
    expect(patterns).toHaveLength(wantPatterns.length);
    expect(patterns.reduce((sum, p) => sum + total(p).captures, 0)).toBe(wantCaptures.length);
  });
});
