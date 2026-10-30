# jint authoring - reference

Generated - do not edit. Regenerate with: `bun run schema`.

## What the provider is (read before writing criteria)

The provider is a classifier, not a chat model: it returns calibrated
probabilities (noul, 0..1) or rubric scores, no explanations. Key properties:

- **0.5 is undecided, not medium.** A noul of 0.45 vs 0.55 is not a ranking.
- **Calibrated middle matters.** Thresholds live in the 0.3-0.8 band; a
  classifier that quantizes to 0/1 is useless here.
- **Positive phrasing can hide defects.** The model leans yes. A file-name rule
  asked "does the name fit the body?" read a body named for another subject as
  fitting (0.97); asked "does the name promise a different subject?" it read the
  same file as a mismatch (0.96). Another rule, casing consistency, separated
  its pairs under a positive question (healthy 0.99-1.00, defective 0.02-0.49),
  so phrase the defect first and let a planted-defect control decide.
- **Scores hedge onto the middle.** A three-level score put most of its mass on
  level 1 (mean probabilities 0.37 / 0.52 / 0.12; level 1 on 389 of 448
  readings; the same property asked as a yes/no also sat near 0.5). Yes/no rules
  on properties with a clear pole read cleanly. Use a rubric only when the
  property really is graded.
- **State shape.** One state x many questions per call is valid and does not
  move the readings (160 of 160 identical batched and alone). Never stack
  elements into one state yourself: the frame is the unit.

## Noul example: a two-sided criteria contract

Rendered from the live spec `is_greppable` (always the current
wire shape):

```json
{
  "name": "is_greppable",
  "instructions": "Are the identifiers in this function searchable with terms a developer would use to find this code?",
  "criteria": {
    "true": "The code identifiers judged here are those in the function's declaration and body - its own name, its parameters, its locals, and the names it reads - and they are greppable: written out in full at every occurrence, never split into fragments or dynamically constructed from pieces, never renamed at a boundary, and specific enough that a search hit is genuinely a reference to this thing.",
    "false": "At least one identifier in the function cannot be found by a single search: it is split into fragments or dynamically constructed from pieces, renamed at a boundary so the same concept needs two search strings, or is a bare word (data, handler, util) whose hits are mostly noise. CLI flag spellings, help text, and log messages are user-facing interface, not code identifiers, and are outside this rule."
  },
  "target": "functions",
  "handle": {
    "warn": {
      "less_than": 0.75
    },
    "error": {
      "less_than": 0.6
    }
  }
}
```

Note the shape: `true` names the exact observable condition for yes, `false`
for no, and both sides are exhaustive. The defect side decides the handle
direction.

## Score example: the scored rubric

Use a rubric only when the property is graded, not yes/no (scores hedge: see
above). The instructions carry a
scoping sentence ("do not score X here"); the ordered criteria are the score
legend; levels are descriptions, not true/false. Rendered from the live spec
`is_cognitively_complex`:

```json
{
  "name": "is_cognitively_complex",
  "kind": "score",
  "instructions": "How much EFFORT does a reader need to follow this code's logic - effort caused by structure the author chose, not by the problem itself? Ignore length alone: a long linear unit with one job reads as easy. Ignore inherent complexity: cases the data or the domain genuinely force are not this failure. Judge how hard the code's own structure makes it to read top-to-bottom.",
  "criteria": [
    "Easy: the logic reads top-to-bottom. A single pass suffices. Any difficulty present is inherent to the problem, not to the structure.",
    "Moderate: the reader must pause once or twice - hold a small amount of state across a few lines, or re-check an outer condition - but the structure is otherwise linear and the full flow is recoverable by re-reading one or two spots.",
    "Hard: following the code requires actively reconstructing its flow - a stack of nested conditions to track, several unrelated concerns fused into one unit, state held across many lines, or an order that forces jumps instead of top-to-bottom reading. The structural difficulty could be removed without changing what the code does."
  ],
  "target": ["functions", "classes", "methods", "types", "bindings"],
  "handle": {
    "map": [
      "pass",
      "warn",
      {
        "level": "error",
        "message": "Decompose this function: extract readable named steps so the main body reads easily."
      }
    ]
  }
}
```

## The criteria shape that fails

This shape reads reasonable and fails on a healthy corpus:

```json
  "rules": [
    {
      "name": "will_naming_drift",
      "target": "definitions",
      "criteria": {
        "true": "The change introduces naming drift: the same concept is called by different names across the change.",
        "false": "Naming is consistent."
      },
      "handle": { "warn": { "greater_than": 0.5 }, "error": { "greater_than": 0.7 } }
    }
  ]
```

It fails three ways: `false` is generic (name the exact observable condition),
the claim spans multiple elements - the model sees only its own frame and
compares against names it cannot see - and "drift" invites narrating quality
instead of checking a condition.
The fix is never thresholds; rewrite the criteria until they name an observable
condition.
