import type { CustomElement, CustomFile, CustomRule, RuleContext } from "./schema.ts";

type Fields<T> = Readonly<Record<keyof T, readonly [type: string, meaning: string]>>;

/** The rule fields that only a TypeScript config can hold. */
export const FUNCTION_FIELDS: Fields<Pick<CustomRule, "state" | "classify" | "target" | "handle">> =
  {
    state: [
      "(target) => object",
      "Composes what the model reads about one element. Each key is a part, and a part with no value is left out. It replaces the element's own source, and a function that throws fails that element only.",
    ],
    classify: [
      "(target) => { instructions, criteria, state }",
      "Composes the question too, when it changes from one element to the next. A rule has state or classify, never both.",
    ],
    target: [
      "(elements) => elements",
      "Chooses the elements to judge. It is given every element of the run.",
    ],
    handle: [
      "(results, ctx) => decisions",
      "Decides the severity of each result, after every element is classified. A null severity raises no finding.",
    ],
  };

export const CONTEXT_FIELDS: Fields<RuleContext> = {
  targets: ["element[]", "Every element the rule judges in this run."],
};

export const FILE_FIELDS: Fields<
  Omit<CustomFile, Exclude<keyof CustomElement, "path" | "source" | "getElement" | "getElements">>
> = {
  path: ["string", "The file's path."],
  source: ["string", "The file's whole text."],
  getElement: [
    "(target, name?) => element",
    "The one element at the top of the file that a selector matches. It throws when there is none, or more than one.",
  ],
  getElements: [
    "(target?) => element[]",
    "The elements at the top of the file that a selector matches, or all of them, in file order.",
  ],
  definitions: ["element[]", "The file's definitions, at any depth."],
  comments: ["element[]", "The file's comments, at any depth."],
  imports: ["element[]", "The file's imports."],
};

export const ELEMENT_FIELDS: Fields<CustomElement> = {
  name: ["string", "The declared name, or the heading's text. Absent when the capture has none."],
  key: ["string", "The key of a pair, which has one in place of a name."],
  value: ["string", "What the element holds under its name or key."],
  source: ["string", "The element's text, less what its grammar omits from the capture."],
  parent: ["element | null", "The element this one sits inside."],
  file: ["file", "The file the element is in. A file's own is itself."],
  getElement: [
    "(target, name?) => element",
    "The one element directly inside this one that a selector matches. It throws when there is none, or more than one.",
  ],
  getElements: [
    "(target?) => element[]",
    "The elements directly inside this one that a selector matches, or all of them, in file order.",
  ],
  capture: ["string", "What the element is, as its grammar captures it."],
  grammar: ["string", "The grammar that captured the element."],
  path: ["string", "The file the element is in."],
  span: ["object", "Where the element is in the file: lines, columns and bytes."],
  signature: ["string", "A definition's text up to its body, or its first line."],
  attachedComment: ["string[]", "The comment run directly above a definition."],
  docstrings: ["string[]", "The docstrings a definition owns outside its own text."],
  docstringOf: ["object", "For a docstring: the definition it documents."],
  internalCommentCount: ["number", "How many comments sit inside the element."],
  docstringCount: ["number", "How many docstrings the definition owns."],
  id: ["string", "The element's identity in this run."],
  label: ["string", "The element's position in its file, such as d0."],
};
