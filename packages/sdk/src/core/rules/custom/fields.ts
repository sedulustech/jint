import type { ClassifyContext, CustomElement, CustomFile, CustomRule } from "./schema.ts";

type Fields<T> = Readonly<Record<keyof T, readonly [type: string, meaning: string]>>;

/** The rule fields that only a TypeScript config can hold. */
export const FUNCTION_FIELDS: Fields<Pick<CustomRule, "state" | "classify" | "target" | "handle">> =
  {
    state: [
      "(self, ctx) => object",
      "Composes what the model reads about one element. Each key is a part, and a part with no value is left out. It replaces the element's own source, and a function that throws fails that element only.",
    ],
    classify: [
      "(self, ctx) => { instructions, criteria, state }",
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

export const CONTEXT_FIELDS: Fields<ClassifyContext> = {
  file: ["object", "The file the element is in."],
  targets: ["element[]", "Every element the rule judges in this run."],
};

export const FILE_FIELDS: Fields<CustomFile> = {
  path: ["string", "The file's path."],
  source: ["string", "The file's whole text."],
  element: [
    "(target, name?) => element",
    "The one element in the file that a target takes. It throws when there is none, or more than one.",
  ],
  elements: [
    "(target?) => element[]",
    "The elements in the file that a target takes, or all of them, in file order.",
  ],
  definitions: ["element[]", "The file's definitions."],
  comments: ["element[]", "The file's comments."],
  imports: ["element[]", "The file's imports."],
};

export const ELEMENT_FIELDS: Fields<CustomElement> = {
  name: ["string", "The declared name, or the heading's text. Absent when the capture has none."],
  value: ["string", "What the element holds under its name, such as the value of a key."],
  source: ["string", "The element's text, less what its grammar omits from the capture."],
  parent: ["element | null", "The element this one sits inside."],
  element: [
    "(target, name?) => element",
    "The one element directly inside this one that a target takes. It throws when there is none, or more than one.",
  ],
  elements: [
    "(target?) => element[]",
    "The elements directly inside this one that a target takes, or all of them, in file order.",
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
