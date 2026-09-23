# Glossary

Canonical vocabulary for jint contributors and agents. Each term's definition
matches how the code uses it today; terms are added here when introduced.

## Scope

measurement vs finding: a measurement is always produced and never actionable; a finding is a
measurement its handle judged actionable and is the only output that demands action.

## Terms

- **noul** — the number the model returns per question: a calibrated probability in [0, 1]
  that the claim holds; values pass through untouched.
- **measurement** — the raw noul value for one (sensor, input) pair:
  `{ sensor, input, value, stage? }`; always produced, never actionable by itself.
- **finding** — a measurement its handle judged actionable: the handle returned
  `"error"` or `"warn"` (null means silent), `{ sensor, input, value, severity }`, with a
  `location` span where the input is a piece of a larger unit; the only actionable output — it
  drives the report and the exit code.
- **sensor** — the measuring mechanism `{ name, description, target, handle }`; the
  description is the exact calibrated claim compiled into the noul question (editing it is a
  re-calibration event), names follow the `is_`/`will_` proposition convention.
- **criteria** — the `{ true, false }` prose on a QuestionSpec describing what each answer
  means; block-scoped questions get block criteria.
- **target** — which unit kinds a sensor judges: `"files" | "definitions" |
"comments" | "imports" | "diffs"`; the extension surface, sensors per target land incrementally —
  no default sensor targets imports or diffs yet.
- **handle** — the sensor's policy callback `(value) => "error" | "warn" | null` (null is
  silent); override it in config to change thresholds; readings over file pieces never run handles —
  only whole-unit readings do.
- **severity** — what a handle returned: `"error"` (exit code 1) or `"warn"`.
- **state** — exactly the shape the model judges: file `{ path, content }`, diff
  `{ path, diff, commit_message }`, piece array `{ path, blocks }`.
- **question** — a QuestionSpec `{ type: "noul", instructions, criteria? }`; the record key
  is the question id, never sent to the model, only correlating answers back to sensors; piece ids
  read `"<sensor> in block-N"` with a FROZEN scoping sentence appended to the instructions.
- **instructions** — the plain-string yes/no question on a QuestionSpec, compiled verbatim
  from the sensor's description.
- **answer** — the single calibrated probability returned per question, validated in shape;
  missing or non-finite becomes JEV_RESPONSE_INVALID.
- **unit** — a resolved thing to measure `{ kind: "file" | "diff", state }`; dirs exist only at
  inference time and resolve to file units before measuring.
- **parsing** — turning source text into a tree-sitter syntax tree; the first step of deriving a
  file's inventory.
- **inventory** — the set of leaves derived from one file: parse the source into a syntax tree,
  walk the top-level nodes, classify each by role; the inventory is what targets select from.
- **classifying** — asking the model whether a claim holds for one state: sensors compile to
  yes/no questions, the model answers each with a noul probability; jint only ever classifies
  states, it never generates or transforms them.
- **span** — a LOC pointer into the unit that locates the exact piece a reading is about
  (`{ start, end }` line/column points plus byte offsets); spans ride
  on findings as `location` so a report can show the classified source.
- **leaf** — one top-level piece of the unit inventory, derived by parsing and walking: definitions
  `d0…`, standalone comments `c0…`, the single merged import leaf `i0`, each with an exact span;
  a definition's directly-preceding docblock is consumed into it as an attached comment.
- **node** — a tree-sitter syntax node; leaf types include function_declaration, comment,
  export_statement.
- **walker / walk** — two senses: the tree walk that classifies top-level nodes into the
  inventory (skips error nodes, unwraps export statements), and the directory walk that turns an
  on-disk tree into file units honoring exclusions.
- **role** — the classification a top-level node gets during the walk: definition, comment,
  import; the per-language node-type lists that decide it are the mapping.
- **diff** — one of the three input kinds; sources are `-` (stdin, the primitive), a patch file, or
  a rev expression that shells out to git; the per-file
  unified-diff block string is judged verbatim as the unit's state, with the commit message as
  shared state, deleted/binary files skipped; a parse-into-hunks path is future work.
