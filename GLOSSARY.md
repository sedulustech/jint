# Glossary

Canonical vocabulary for jint contributors and agents. Concepts only - implementation detail
lives in the code and docs. Each definition matches how the code uses the term today; terms are
added here when introduced, and only when necessary.

## Scope

measurement vs finding: a measurement is always produced (a value, or refused) and never
actionable; a finding is a measurement its handle judged actionable and is the only output that
demands action.

## Terms

- **answer** — what the model returns per question: a calibrated probability, or a refusal.
- **binding** — an element that is a name bound to a non-callable, non-type value.
- **class** — an element that is a class-like unit: the @class capture (ts/tsx/python/php/cpp
  class declarations). Split from @type so a rule can judge classes as classes; every other type
  shape (interfaces, structs, enums, aliases, modules) stays @type.
- **classifying** — asking the model whether a claim holds for one state; jint only ever
  classifies states, it never generates or transforms them.
- **capture** — the jint-owned name a grammar's queries assign to a matched node
  (function, method, class, type, binding, comment, import): what one element IS. Singular names
  one element; the plural addresses the group a rule targets. A capture name is an identity,
  never a label; the names are flat capture names — no dotted names at either layer, decided and final.
  Replaces role (the living collision).
- **capture (verb)** - run extraction over an input under a chosen grammar and query set,
  yielding elements; the classifier stays unplugged. One word, two layers (deliberate duality):
  the SDK function `capture()` is lint's pipeline with the classifier unplugged, and the CLI
  verb `jint capture` is a thin print of that function. Its elements carry `text` - the span
  content truncated at 200 chars (one ellipsis); the span stays the authority for full content.
  The config-loading variant (`captureFor`, the CLI's default) loads the config like run does, so capture
  previews the population a rule will judge; capture with --rule marks that population and
  nothing is classified.
- **capture vocabulary** — the two tiers the runtime knows: the SHARED CAPTURES (function,
  method, class, type, binding, comment, import, docstring) every grammar may address, closed and
  promoted by ceremony, plus the OPEN NAMESPACE of GRAMMAR-AUTONOMOUS captures a grammar's own
  .scm declares with a `capture.<name>.definition` directive (markdown's section, paragraph,
  list, list_item; any BYOG future) - no engine registration. A capture that is neither shared
  nor declared fails the run at setup naming the directive to add. The @name capture renders a
  definition's name; `test` is RESERVED (a valid token no grammar emits yet, held for the test
  capture).
- **directive** — a #set! fact in a queries.scm attached to one pattern declaring how the engine treats what that pattern extracts; validated at load. Naming principle: the prefix names the grouper, the suffix the knob, the value the setting; names never name the node — the pattern is the target.
- **selfNesting** — a grammar's .scm #set! directive (#set! "selfNesting", beside the pattern whose shape it changes): same-capture candidates nest legitimately
  (markdown's sections). Absent: a same-capture match inside an existing same-capture
  element reads as a wrapper's payload and collapses into it unless the tail distance is real (the per-grammar capture directives over the shared defaults).
- **choice** — a rule kind whose question selects one named option; the answer is the selected
  option's label, with a probability per option.
- **confidence** — the provider's own number, 0-1, on a score or choice answer. Not derived from the
  probabilities and never an input to a verdict; absent when the provider returns none.
- **criteria** — the prose on a question describing what each answer means; pins the boundary.
- **diff** — an input kind: a unified patch, judged as per-file blocks.
- **scope** — a path selection with an owner: include/exclude patterns that select which files
  a rule may measure. The config's scope is its include/exclude; a rule's scope is its own
  include/exclude and claims across the config exclude. The denylist and gitignore are not
  scopes: they exclude, and always win.
- **dimension** — one semantic property of the measured subject. Orthogonal dimensions of one subject stay separate rules or questions; a criteria stacking several is a rule trying to be two.
- **descent default** — the per-capture policy for what a captured element's interior yields: a
  @type interior surfaces (a method is an element of its own); a @function or @binding interior
  is opaque to different captures (a local binding in a body is implementation), while a
  same-capture nest surfaces as a child of its own unless it is absorb-shaped (nested functions).
- **element** — the measured subject: one thing a rule can judge — a file, a diff block, or a
  node-derived function, comment, type, binding, or import. Carries its hierarchy (parent). The
  union of element kinds (FileElement, FunctionElement, ...) is what a measurement references;
  the walk-time form additionally carries the element's source. Targets stay rule-side: a rule
  resolves targets, an element is what they land on.
- **node type** — one grammar's raw tree-sitter node type (node-types.json); grammar-local,
  with no shared meaning across grammars. Never a rule target (the lang:node_type lane was
  cancelled 2026-10-15 with the verilog removal); the qualified capture address is the only
  grammar-local targeting.
- **qualified capture address** — the grammar-scoped targeting form `{grammar}:{capture}` (e.g.
  `markdown:section`, `markdown:paragraph`): the only road to a grammar-autonomous capture. Validated against the
  captures the grammar's queries EMIT (derived syntactically at load - the .scm is the single
  source, no manifest involvement); an unknown grammar or an unemitted capture is a setup error,
  never a silent no-match. The bare form drifted from the design and is schema-rejected.
- **list** — markdown's whole-list capture (@list, md-only): one element per bullet or ordered
  list, spanning every item, markers kept in its text. Lists nest - a nested list is an element
  of its own (the selfNesting fact) - and a rule judging the list whole sees every sibling
  entry (`markdown:list`).
- **list_item** — markdown's list-entry capture (@list_item, md-only): the paragraph inside a
  bullet or numbered item - marker stripped, continuations folded in, one element per entry; an
  in-list paragraph is a list_item, never a paragraph (`markdown:list_item`).
- **paragraph** — markdown's flat prose capture (@paragraph, md-only): a run of body text with
  no heading and no interior structure worth judging alone. Flat by construction - paragraphs
  never nest, so it needs no shape directive - and addressed through the qualified lane
  (`markdown:paragraph`).
- **statement_group** — typescript's and tsx's top-level code capture (@statement_group,
  `typescript:statement_group`): executable statements at program level that no definition owns
  (a script's setup calls, a CLI's main loop), one element per run of adjacent statements. Only
  another element ends the run - blank lines and comments ride inside (capture merge
  "adjacent"); opaque, so a loop's bindings are its implementation. A test construct stays a
  function.
- **false positive rate**
  — findings a human reviewer would reject as wrong or not actionable,
  over total findings; estimated by span-level spot-checks during calibration.
- **finding** — a measurement its handle judged actionable; the only output that demands action.
- **grammar** — the parser (wasm) plus its extraction half (queries.scm assigning captures);
  shipped embedded, one directory per language, overridable per custom grammar dir.
- **handle** — the rule's policy: thresholds (declarative) or a policy callback (TS tier) that
  turns measurements into findings.
- **headword** — the term a glossary entry defines: the bolded phrase before the em dash.
  The entry describes its headword and nothing outside it.
- **input** — what a run classifies: where the bytes come from, nothing more.
- **input kind** — how the CLI interprets an input: file, dir, diff, or str. CLI perspective;
  not to be confused with target (rule perspective).
- **identity vs label** — every tracked entity carries one id: a uuidv4 minted at creation and
  propagated unchanged through every payload (request record, measurement input, finding, cell),
  never the state sent to the model: a fresh id each run would make identical code a different
  request. A label ("d0", "L10", a span string) is the renderable part of an entity, never its
  key, never a join target. The two never meet: ids are keys, labels are display. Positional
  strings shift on edits and collide across files; ids need neither stability nor readability
  because the run scopes every address.
- **instructions** — the question stating the claim being judged; kind-stated (says what the
  unit is). Criteria pins the boundary; editing either is a recalibration event.
- **inventory** — the set of elements derived from one file.
- **measurement** — the raw reading for one (rule, element) pair; always produced (a value, or
  refused), never actionable by itself.
- **node** — a tree-sitter syntax node.
- **noul** — the number the model returns per question: a calibrated probability in [0, 1] that
  the claim holds.
- **noun** — the CLI word for a declared input read, INSIDE run: the first positional of
  run's payload names the read (str, paths). The resource (a path) needs no noun. A noun's next
  positional is its payload.
- **parsing** — turning source text into a parse tree; the first step of deriving an inventory.
- **pass** — the level a handle returned when a reading needs no action: the score-map or
  choice tier that never fires (both use pass/warn/error) and the absent-reading state for
  noul handles. Not a finding, not noise: a reading judged acceptable.
- **path list** — one flat list of paths, one per line, read as declared (`jint run paths -`): no
  VCS vocabulary, no path algebra — entries are the caller's bytes used verbatim as file
  identity. A malformed list is a named LIST_* setup error (unreadable bytes, an entry that
  would need interpreting, empty); a listed path that resolves to nothing is a
  not-in-the-walk note, never a silent skip.
- **payload** — the positional after a noun: always `-`, declaring piped stdin as the read.
  There is no inline payload; a noun followed by anything else is a usage error naming the
  correct form.
- **undecided** — a reading too close to call: its top tier's probability leads the runner-up
  tier's by less than the rule's `margin`. The rule maps it to a tier and message like any other.
- **refused** — a measurement with no value: the model was asked and gave no answer, so the question did not apply to the state as it was judged. Not a severity and not an error: no handle reads it, no finding follows. Wire name: `refusal`. Distinct from undecided (an answer too close to call) and from a skip (jint chose not to ask).
- **verb** — the CLI command word: the FIRST positional IS the command (run, serve, capture)
  and the rest are its operands; there is no implicit verb, so a missing or unknown first
  positional is a usage error. A verb token is never a path (a file named capture is reached as
  `jint run ./capture`).
- **provider** — the service at the Decisions endpoint that jint asks its questions of. The url selects it (config `url` > JINT_PROVIDER_URL > the default); the key is config `apiKey` > JINT_PROVIDER_KEY. An overridden url or key is reported in a run note.
- **question** — one classified judgment request sent to the model about one state.
- **rule** — the classifying mechanism: name, criteria, target, classify, handle. Rules fire;
  findings result.
- **request** — the recorded classifier call: the exact bytes sent to the model and the
  response, plus metadata (ts, status). Software terminology, deliberately broad. Distinct from question: a request is the recorded CALL
  (what the model saw and answered); a question is one judgment inside it.
- **result** — the tool's derived outcome for one request: the answers, per-rule verdicts,
  and timings a request produced. A result is a SUBSET of its request — the request is the
  recorded call, the result is what jint derived from it.
- **test** — the runs of one rule version on fixed inputs, compared against the previous
  version's. Two runs show the rerun noise. The unit of calibration; not the reserved `test`
  capture.
- **calibration** — testing a rule and editing its instructions or criteria until it is right.
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
- **rule target** — which unit instances a rule judges; resolves over the two namespaces
  (FILE / CAPTURE) and the target vocabulary (files, functions, classes, methods,
  types, bindings, definitions, comments, loose-comments, imports). Declarative: a name or an
  explicit list; the defaults use the list form. 'noun' stays CLI-owned - it names a declared
  input read, never a capture.
- **definitions (target)** — the umbrella shorthand for every definition capture at once
  (functions, classes, methods, types, bindings): the same measured set as the explicit union.
  Demoted to shorthand — new rules prefer the specific targets; the defaults no longer use it.
- **unit** — one classifiable piece produced by resolving an input according to its input kind.
- **walker / walk** — the pass that turns parsed sources into inventory elements (and the
  directory pass that turns an on-disk tree into file units).
