# Glossary

Canonical vocabulary for jint contributors and agents. Each term's definition
matches how the code uses it today; terms are added here when introduced.

## Scope

measurement vs finding: a measurement is always produced and never actionable; a finding is a
measurement its handle judged actionable and is the only output that demands action.

## Terms

- **noul** — the number the model returns per question: a calibrated probability in [0, 1]
  that the claim holds; values pass through untouched.
- **measurement** — the raw reading for one (rule, element) pair:
  `{ rule, element, value, stage }`; always produced, never actionable by itself.
- **finding** — a measurement its handle judged actionable: the handle returned
  `"error"` or `"warn"` (null means silent), `{ rule, element, value, severity }`, with a
  `location` span where the element is part of a larger unit; the only actionable output — it
  drives the report and the exit code.
- **rule** — the measuring mechanism `{ name, criteria, target, kind, handle }`; the criteria is
  the exact calibrated claim compiled into the question (editing it is a re-calibration event),
  names follow the `is_`/`will_` proposition convention; kind picks the question primitive: noul
  (default) or choice (scored rubric). Rules fire; findings result.
- **criteria** — the `{ true, false }` prose on a QuestionSpec describing what each answer
  means; block-scoped questions get block criteria.
- **input** — what a run measures: a path, a directory, a patch file, piped text, or the config's input field; resolved into the units the rules judge. Where the bytes come from, nothing more. The only input whose kind cannot be safely inferred is piped text (stdin), which must be declared (str or diff).
- **input kind** — how the CLI interprets an input: file, dir, diff, or str. Decides how bytes are read and whether the source is parsed. Inferred when the source is unambiguous (a path is a file, a directory is a dir); declared for stdin. Not to be confused with target: the input kind is CLI perspective, the target is rule perspective; they meet at the unit.
- **unit** — one measurable piece produced by resolving an input according to its input kind: a file unit `{ path, content }`, a diff block, or one str unit (dirs resolve to file units before measuring; the str unit carries a content-hash id). The unit nature decides which rule targets apply: a diff block serves diffs-target rules; a parsed file unit serves functions-, comments-, definitions-, imports-target rules; an unparsed str unit serves files-target only.
- **target** — the element type a rule judges (rule perspective): files, diffs, functions, comments, definitions, imports. Selects which units/elements the rule measures; it is not a CLI concept. Which targets can fire follows from the unit, and the unit follows from the input kind.
- **handle** — the rule's policy callback `(value) => "error" | "warn" | null` (null is
  silent); override it in config to change thresholds; readings over inventory elements never run handles —
  only whole-unit readings do.
- **severity** — what a handle returned: `"error"` (exit code 1) or `"warn"`.
- **state** exactly the shape the model judges: file `{ path, content }`, diff
  `{ path, diff, commit_message }`, element array `{ path, blocks }`.
- **question** a QuestionSpec `{ type: "noul", instructions, criteria? }`; the
  record key is the question id, never sent to the model, only correlating answers back to
  rules; element ids read `"<rule> in <element>"` with a FROZEN scoping sentence appended to
  the instructions.
- **instructions** — the plain-string yes/no question on a QuestionSpec, compiled verbatim
  from the rule's criteria (noul) or the rule's own instructions field (choice).
- **answer** — the single calibrated probability returned per question, validated in shape;
  missing or non-finite becomes JEV_RESPONSE_INVALID.
- **strategy** — a model of the state and questions to send to the classifier (jev) to balance
  performance, accuracy and price; the tried strategies and their results live in STRATEGIES.md.
- **element** one thing a rule can judge: a file, a diff, or a node-derived
  definition, comment, function, binding, or import from a file inventory; the target names the
  element type. An arrow-function const is a function like any callable.
- **binding** — an element that is a name bound to a non-callable, non-type value; judged by
  definitions-target rules, never by functions-target rules.
- **parsing** — turning source text into a tree-sitter syntax tree; the first step of deriving a
  file's inventory.
- **grammar** — the tree-sitter wasm that turns source text into the parse tree the walk
  abstracts into roles; shipped embedded with the binary; adding one = the wasm plus one mapping entry.
- **inventory** the set of elements derived from one file: parse the source into a
  syntax tree, walk the top-level nodes, classify each by role; inventory-scoped targets select
  from it. The file's imports merge into one import element (`i0`) spanning the first through the
  last import; its content carries the module specifiers, so imports-target criteria can talk about
  what is imported.
- **composite** — a parsed structure that is both judged and descended into during the walk (a
  class, a top-level call expression like a describe callback, and nested composites
  recursively): its header is emitted as a regular element, and its body is walked so inner
  nodes become elements too. Composites exist only during the walk.
- **classifying** — asking the model whether a claim holds for one state: rules compile to
  yes/no questions, the model answers each with a noul probability; jint only ever classifies
  states, it never generates or transforms them.
- **span** a LOC pointer into the element that locates what a reading is about
  (`{ start, end }` line/column points plus byte offsets); spans ride on findings as `location`
  so a report can show the classified source.
- **node** — a tree-sitter syntax node; node types include function_declaration, comment,
  export_statement.
- **walker / walk** two senses: the tree walk that classifies nodes into inventory elements
  (top-level nodes, plus the bodies of composites via descent; skips error nodes, unwraps export
  statements), and the directory walk that
  turns an on-disk tree into file units honoring exclusions. An element is not a tree-sitter
  leaf node: a function element usually has children in the tree.
- **role** the classification a top-level node gets during the walk: definition,
  comment, import; the per-language node-type lists that decide it are the mapping, and the role
  is part of what makes the node an inventory element.
- **diff** — one of the three input kinds; sources are `-` (stdin, the primitive), a patch file, or
  a rev expression that shells out to git; the per-file
  unified-diff block string is judged verbatim as the unit's state, with the commit message as
  shared state, deleted/binary files skipped; a parse-into-hunks path is future work.
