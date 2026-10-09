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
- **element** — the measured subject: one thing a rule can judge — a file, a diff block, or a
  node-derived function, comment, type, binding, or import. Carries its hierarchy (parent). The
  union of element kinds (FileElement, FunctionElement, ...) is what a measurement references;
  the walk-time form additionally carries the element's source. Targets stay rule-side: a rule
  resolves targets, an element is what they land on.
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
- **identity vs label** — every tracked entity carries one id: a uuidv4 minted at creation and
  propagated unchanged through every payload (state, question key, measurement input, finding,
  cell). A label ("d0", "L10", a span string) is the renderable part of an entity, never its
  key, never a join target. The two never meet: ids are keys, labels are display. Positional
  strings shift on edits and collide across files; ids need neither stability nor readability
  because the run scopes every address.
- **instructions** — the question stating the claim being judged; kind-stated (says what the
  unit is). Criteria pins the boundary; editing either is a recalibration event.
- **inventory** — the set of elements derived from one file.
- **measurement** — the raw reading for one (rule, element) pair; always produced, never
  actionable by itself.
- **node** — a tree-sitter syntax node.
- **noul** — the number the model returns per question: a calibrated probability in [0, 1] that
  the claim holds.
- **noun** — the CLI word for a declared input read: the FIRST positional names the read
  (str, paths). The resource (a path) needs no noun. A noun's next positional is its payload.
- **parsing** — turning source text into a parse tree; the first step of deriving an inventory.
- **pass** — the level a handle returned when a reading needs no action: the score-map
  entry that never fires (score maps use pass/warn/error) and the absent-reading state for
  noul handles. Not a finding, not noise: a reading judged acceptable.
- **path list** — one flat list of paths, one per line, read as declared (`jint paths -`): no
  VCS vocabulary, no path algebra — entries are the caller's bytes used verbatim as file
  identity. A malformed list is a named LIST_* setup error (unreadable bytes, an entry that
  would need interpreting, empty); a listed path that resolves to nothing is a
  not-in-the-walk note, never a silent skip.
- **payload** — the positional after a noun: always `-`, declaring piped stdin as the read.
  There is no inline payload; a noun followed by anything else is a usage error naming the
  correct form.
- **question** — one classified judgment request sent to the model about one state.
- **role** — the classification a node gets during the walk (function, comment, binding, import,
  ...); roles are the exposed selection vocabulary.
- **rule** — the classifying mechanism: name, criteria, target, classify, handle. Rules fire;
  findings result.
- **request** — the recorded classifier call: the exact bytes sent to the model and the
  response, plus metadata (ts, status). Software terminology, deliberately broad. Distinct from question: a request is the recorded CALL
  (what the model saw and answered); a question is one judgment inside it.
- **result** — the tool's derived outcome for one request: the answers, per-rule verdicts,
  and timings a request produced. A result is a SUBSET of its request — the request is the
  recorded call, the result is what jint derived from it.
- **run** — one execution of jint: input resolution, walk, target resolution, classification,
  findings. The unit of observation: every measurement, finding, dump, and request
  belongs to exactly one run. A failed run is still a run. Calibration compares runs.
- **severity** — what a handle returned: "error" (exit code 1), "warn", or "pass".
- **span** — the exact location of an element: every element is a slice of source. Rides on the
  element (sort key, display) and on findings so a report can show the classified source.
- **state** — exactly what the model judges for one question.
- **strategy** — a model of the state and questions sent to the classifier, balancing
- **sdk** — the in-process library a consumer calls: the engine layer (config, walk, classify,
  lint, output) plus its public barrel. Same process as its caller — "SDK" says call-into-me;
  the retired synonym "engine" implied a separate runtime, which this layer never is.
- **target** — what a rule asks the sdk to resolve into state (rule perspective;
  the input kind is the CLI perspective). Declarative or a selection function.
- **unit** — one classifiable piece produced by resolving an input according to its input kind.
- **walker / walk** — the pass that turns parsed sources into inventory elements (and the
  directory pass that turns an on-disk tree into file units).
