# Glossary

Canonical vocabulary for jint contributors and agents. Concepts only - implementation detail
lives in the code and docs. Each definition matches how the code uses the term today; terms are
added here when introduced, and only when necessary.

## Scope

measurement vs finding: a measurement is always produced and never actionable; a finding is a
measurement its handle judged actionable and is the only output that demands action.

## Terms

- **answer** — the single calibrated probability returned per question.
- **binding** — an element that is a name bound to a non-callable, non-type value.
- **classifying** — asking the model whether a claim holds for one state; jint only ever
  classifies states, it never generates or transforms them.
- **composite** — a parsed structure that is both judged and descended into during the walk; its
  identity is its declaration (header), its body is walked so inner nodes become elements.
  Composites exist only during the walk.
- **criteria** — the prose on a question describing what each answer means; pins the boundary.
- **diff** — an input kind: a unified patch, judged as per-file blocks.
- **element** — one thing a rule can judge: a file, a diff block, or a node-derived function,
  comment, definition, binding, or import. Carries its hierarchy (parent).
- **false positive rate** — findings a human reviewer would reject as wrong or not actionable,
  over total findings; estimated by span-level spot-checks during calibration.
- **finding** — a measurement its handle judged actionable; the only output that demands action.
- **grammar** — the parser that turns source text into the parse tree the walk abstracts into
  roles; shipped embedded with the binary.
- **handle** — the rule's policy: thresholds (declarative) or a policy callback (TS tier) that
  turns measurements into findings.
- **input** — what a run classifies: where the bytes come from, nothing more.
- **input kind** — how the CLI interprets an input: file, dir, diff, or str. CLI perspective;
  not to be confused with target (rule perspective).
- **instructions** — the question stating the claim being judged; kind-stated (says what the
  unit is). Criteria pins the boundary; editing either is a recalibration event.
- **inventory** — the set of elements derived from one file.
- **measurement** — the raw reading for one (rule, element) pair; always produced, never
  actionable by itself.
- **node** — a tree-sitter syntax node.
- **noul** — the number the model returns per question: a calibrated probability in [0, 1] that
  the claim holds.
- **parsing** — turning source text into a parse tree; the first step of deriving an inventory.
- **question** — one classified judgment request sent to the model about one state.
- **role** — the classification a node gets during the walk (function, comment, binding, import,
  ...); roles are the exposed selection vocabulary.
- **rule** — the classifying mechanism: name, criteria, target, classify, handle. Rules fire;
  findings result.
- **run** — one execution of jint: input resolution, walk, target resolution, classification,
  findings. The unit of observation: every measurement, finding, dump, and request capture
  belongs to exactly one run. A failed run is still a run. Calibration compares runs.
- **severity** — what a handle returned: "error" (exit code 1) or "warn".
- **span** — a location pointer into the element that locates what a reading is about; rides on
  findings so a report can show the classified source.
- **state** — exactly what the model judges for one question.
- **strategy** — a model of the state and questions sent to the classifier, balancing
  performance, accuracy, and price; results live in STRATEGIES.md.
- **target** — what a rule asks the engine to resolve into its environment (rule perspective;
  the input kind is the CLI perspective). Declarative or a selection function.
- **unit** — one classifiable piece produced by resolving an input according to its input kind.
- **walker / walk** — the pass that turns parsed sources into inventory elements (and the
  directory pass that turns an on-disk tree into file units).
