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
- **class** — an element that is a class-like unit: the @class capture (ts/tsx/python/php/cpp
  class declarations). Split from @type so a rule can judge classes as classes; every other type
  shape (interfaces, structs, enums, aliases, modules, sections) stays @type.
- **classifying** — asking the model whether a claim holds for one state; jint only ever
  classifies states, it never generates or transforms them.
- **capture** — the jint-owned shared noun a grammar's queries assign to a matched node
  (function, method, class, type, binding, comment, import): what one element IS. Singular names
  one element; the plural addresses the group a rule targets. A capture name is an identity,
  never a label; the names are flat nouns — no dotted names at either layer, decided and final.
  Replaces role (the living collision).
- **capture vocabulary** — the frozen set of captures the runtime knows: SEVEN SHARED NOUNS
  (function, method, class, type, binding, comment, import) that every grammar addresses and the
  target union covers, plus GRAMMAR-AUTONOMOUS captures no shared target addresses — python's
  docstring convention (a comment-kind capture: owned by its enclosing definition) and markdown's
  section (prose's container-with-body; the BYOG precedent) — and the @name capture that renders a
  definition's name. A query capturing outside the set fails the run at setup. `test` is
  RESERVED (a valid token no grammar emits yet, held for the test noun).
- **sameCaptureNesting** — a grammar manifest fact: same-capture candidates nest legitimately
  (markdown's sections). Default false: a same-capture match inside an existing same-capture
  element reads as a wrapper's payload and collapses into it (the policy table in query.ts).
- **criteria** — the prose on a question describing what each answer means; pins the boundary.
- **diff** — an input kind: a unified patch, judged as per-file blocks.
- **dimension** — one semantic property of the measured subject. Orthogonal dimensions of one subject stay separate rules or questions; a criteria stacking several is a rule trying to be two.
- **descent default** — the per-noun policy for what a captured element's interior yields: a
  @type interior surfaces (a method is an element of its own); a @function or @binding interior
  is opaque (a body's captures are implementation, never elements).
- **element** — the measured subject: one thing a rule can judge — a file, a diff block, or a
  node-derived function, comment, type, binding, or import. Carries its hierarchy (parent). The
  union of element kinds (FileElement, FunctionElement, ...) is what a measurement references;
  the walk-time form additionally carries the element's source. Targets stay rule-side: a rule
  resolves targets, an element is what they land on.
- **node type** — one grammar's raw tree-sitter node type (node-types.json); grammar-local,
  written lang:node_type when addressed, with no shared meaning across grammars. The middle of
  the three rule-target namespaces: FILE / NODE TYPE / CAPTURE.
- **qualified capture address** — the grammar-scoped targeting form `{grammar}:{capture}` (e.g.
  `markdown:section`): the only road to a grammar-autonomous capture. Validated against the
  captures the grammar's queries EMIT (derived syntactically at load - the .scm is the single
  source, no manifest involvement); an unknown grammar or an unemitted capture is a setup error,
  never a silent no-match. The bare form drifted from the design and is schema-rejected.
- **false positive rate** — findings a human reviewer would reject as wrong or not actionable,
  over total findings; estimated by span-level spot-checks during calibration.
- **finding** — a measurement its handle judged actionable; the only output that demands action.
- **grammar** — the parser (wasm) plus its extraction half (queries.scm assigning captures);
  shipped embedded, one directory per language, overridable per user grammar dir.
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
- **comments** — the rule target for DOCUMENTATION: the pair frame — a definition judged together
  with the comments it owns (its attached run, its internal notes, its docstrings, and its code).
  A module-level docstring has no definition frame either — it is loose commentary, like any other
  unowned run. An owned
  comment element never matches separately, so a narration rule fires exactly once per documented
  definition. The name is deliberately shared with @comment in the sanctioned singular/plural
  split: the capture names ONE comment element, the target plural addresses the documentation
  units a rule judges. Default rules target this, not loose-comments.
- **loose-comments** — the complement of comments: comment elements NO definition owns (standalone
  runs, and inline comments outside any definition). Together with comments it is disjoint and
  jointly exhaustive over comment text, so a rule can measure a comment under exactly one target
  and none escapes both.
- **method** — an element that is a member function: the @method capture (ts/tsx
  method_definition, python class-body function_definitions — the structural-context capture —,
  go/php receivers and member shapes, cpp in-class and out-of-line K::f definitions). Split from
  @function so a rule can judge members as members.
- **rule target** — which unit instances a rule judges; resolves over the three namespaces
  (FILE / NODE TYPE / CAPTURE) and the target vocabulary (files, functions, classes, methods,
  types, bindings, definitions, comments, loose-comments, imports). Declarative: a name or an
  explicit list; the defaults use the list form. 'noun' stays CLI-owned - it names a declared
  input read, never a capture.
- **definitions (target)** — the umbrella shorthand for every definition capture at once
  (functions, classes, methods, types, bindings): the same measured set as the explicit union.
  Demoted to shorthand — new rules prefer the specific targets; the defaults no longer use it.
- **unit** — one classifiable piece produced by resolving an input according to its input kind.
- **walker / walk** — the pass that turns parsed sources into inventory elements (and the
  directory pass that turns an on-disk tree into file units).
