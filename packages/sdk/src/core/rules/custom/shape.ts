/**
 * What a custom rule's callbacks are given: the element, the file it sits in and the contexts. The
 * schemas define the fields; the types derive from them and the reference reads them. `display` is
 * the field's type as the reference writes it.
 */

import { Kind, Type, type Static, type TSchema } from "@sinclair/typebox";
import type { InventoryElement } from "../../grammars/walk.ts";

/** A field whose value is a function: the schema checks `typeof` and carries the signature type. */
export function functionField<Signature>(options: { description: string; display: string }) {
  return Type.Unsafe<Signature>({
    ...options,
    [Kind]: "Function",
    type: "Function",
  });
}

function readonlyList<T extends TSchema>(
  item: T,
  options: { description: string; display: string },
) {
  return Type.Unsafe<readonly Static<T>[]>(Type.Array(item, options));
}

const ELEMENT_SCHEMA = Type.Object({
  name: Type.Optional(
    Type.String({
      description: "The declared name, or the heading's text. Absent when the capture has none.",
      display: "string",
    }),
  ),
  key: Type.Optional(
    Type.String({
      description: "The key of a pair, which has one in place of a name.",
      display: "string",
    }),
  ),
  value: Type.Optional(
    Type.String({
      description: "What the element holds under its name or key.",
      display: "string",
    }),
  ),
  source: Type.String({
    description: "The element's text, less what its grammar omits from the capture.",
    display: "string",
  }),
  parent: Type.Unsafe<CustomElement | null>({
    description: "The element this one sits inside.",
    display: "element | null",
  }),
  file: Type.Unsafe<CustomFile>({
    description: "The file the element is in. A file's own is itself.",
    display: "file",
  }),
  getElement: functionField<(target: string, name?: string) => CustomElement>({
    description:
      "The one element directly inside this one that a selector matches. It throws when there is none, or more than one.",
    display: "(target, name?) => element",
  }),
  getElements: functionField<(target?: string) => readonly CustomElement[]>({
    description:
      "The elements directly inside this one that a selector matches, or all of them, in file order.",
    display: "(target?) => element[]",
  }),
  capture: Type.Unsafe<InventoryElement["capture"]>(
    Type.String({
      description: "What the element is, as its grammar captures it.",
      display: "string",
    }),
  ),
  grammar: Type.String({
    description: "The grammar that captured the element.",
    display: "string",
  }),
  path: Type.String({
    description: "The file the element is in.",
    display: "string",
  }),
  span: Type.Unsafe<InventoryElement["span"]>({
    description: "Where the element is in the file: lines, columns and bytes.",
    display: "object",
  }),
  signature: Type.Optional(
    Type.String({
      description: "A definition's text up to its body, or its first line.",
      display: "string",
    }),
  ),
  attachedComment: Type.Optional(
    readonlyList(Type.String(), {
      description: "The comment run directly above a definition.",
      display: "string[]",
    }),
  ),
  docstrings: Type.Optional(
    readonlyList(Type.String(), {
      description: "The docstrings a definition owns outside its own text.",
      display: "string[]",
    }),
  ),
  docstringOf: Type.Optional(
    Type.Unsafe<NonNullable<InventoryElement["docstringOf"]>>({
      description: "For a docstring: the definition it documents.",
      display: "object",
    }),
  ),
  internalCommentCount: Type.Number({
    description: "How many comments sit inside the element.",
    display: "number",
  }),
  docstringCount: Type.Number({
    description: "How many docstrings the definition owns.",
    display: "number",
  }),
  id: Type.String({
    description: "The element's identity in this run.",
    display: "string",
  }),
  label: Type.String({
    description: "The element's position in its file, such as d0.",
    display: "string",
  }),
});

/**
 * The element a rule sees: what the walk found, in its file, linked to the elements around it.
 * Every field of the walk's element reaches a rule unless it is left out here.
 */
export interface CustomElement extends Readonly<Static<typeof ELEMENT_SCHEMA>> {}

const elementList = (options: { description: string; display: string }) =>
  readonlyList(Type.Unsafe<CustomElement>({}), options);

const FILE_SCHEMA = Type.Object({
  path: Type.String({ description: "The file's path.", display: "string" }),
  source: Type.String({
    description: "The file's whole text.",
    display: "string",
  }),
  getElement: functionField<(target: string, name?: string) => CustomElement>({
    description:
      "The one element at the top of the file that a selector matches. It throws when there is none, or more than one.",
    display: "(target, name?) => element",
  }),
  getElements: functionField<(target?: string) => readonly CustomElement[]>({
    description:
      "The elements at the top of the file that a selector matches, or all of them, in file order.",
    display: "(target?) => element[]",
  }),
  definitions: elementList({
    description: "The file's definitions, at any depth.",
    display: "element[]",
  }),
  comments: elementList({
    description: "The file's comments, at any depth.",
    display: "element[]",
  }),
  imports: elementList({
    description: "The file's imports.",
    display: "element[]",
  }),
});

/**
 * A file, as the walk saw it. It is the element a file rule judges, and the file every other
 * element sits in.
 */
export interface CustomFile extends CustomElement, Readonly<Static<typeof FILE_SCHEMA>> {}

/** How a rule picks captured elements: those directly inside an element, or at the top of a file. */
export type ElementSelection = Pick<CustomFile, "getElement" | "getElements">;

const RULE_CONTEXT_SCHEMA = Type.Object({
  targets: elementList({
    description: "Every element the rule judges in this run.",
    display: "element[]",
  }),
});

/** The rule's environment, assembled by the engine after target resolution. */
export interface RuleContext extends Readonly<Static<typeof RULE_CONTEXT_SCHEMA>> {}

/** The fields of each shape, for the reference. */
export const SHAPE_SCHEMAS = {
  element: ELEMENT_SCHEMA,
  file: FILE_SCHEMA,
  context: RULE_CONTEXT_SCHEMA,
};

type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;
type Assert<T extends true> = T;
type WalkFields = Omit<InventoryElement, "content" | "nodeType" | "oversized" | "parent">;
type OwnFields = "path" | "source" | "parent" | "file" | "getElement" | "getElements";

/** A field in the walk's element and not in the rule's, or the reverse, fails these two. */
export type ElementFieldsMatchWalk = [
  Assert<Same<keyof CustomElement, keyof WalkFields | OwnFields>>,
  Assert<Same<Pick<CustomElement, keyof WalkFields>, WalkFields>>,
];
