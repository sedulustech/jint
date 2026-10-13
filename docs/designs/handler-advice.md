---
title: Handler advice
status: draft
modified: 2026-10-12
---

## What exists today

A rule's handler is data: thresholds that turn a measurement into pass / warn /
error (`warn_at`, `error_at`, score `map`). The CLI prints the verdict - rule,
location, severity, value - but nothing about what to DO. An agent reading a
finding re-derives the remedy from the rule's criteria prose, every time, and
the criteria say what the rule measures, not how to fix each severity.

## Decision

Handlers grow an optional `advice` table, one string per outcome:

```ts
is_comment_narration: {
  handler: { fires_when: "true", warn_at: 0.3, error_at: 0.45 },
  advice: {
    warn: "Trim the comment to the decision it records; the code already says the rest.",
    error: "The comment restates the code. Delete it, or rewrite it as the WHY the code cannot say.",
  },
},
```

- The CLI renders the matching string beneath the finding line (indented, after
  the severity/value fields) - stdout finding data stays line-parseable; advice
  is a continuation line of the finding it belongs to.
- Advice is per rule AND per severity, because warn and error are different
  situations needing different instructions, not different volumes of the same
  one.
- Defaults ship in the defaults package beside their handlers; a config rule
  override replaces `advice` wholesale by name, same merge semantics as every
  other rule field (no partial merge of the two strings).
- `pass` needs no advice - nothing to do is already the answer.

## Rejections

| what                                       | why                                                                                                         |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| advice keyed by numeric band, not severity | the handler already owns bands; severity is the contract consumers read; two keys for the same job is drift |
| free-form extra fields on the finding JSON | untyped escape hatch; one field, one consumer (the renderer)                                                |
| agent-only output mode for advice          | the advice is true for humans too; a second rendering path is a second authority                            |

## Definitions

- **advice** - the per-severity remedy string carried beside a rule's handler;
  rendered on the finding it explains. From advisory-text systems; deliberately
  the plain word, not a coinage.

## Questions

### Settled

#### Does advice enter the finding JSON or the report endpoint?

No - render-side only for now. (2026-10-12) The UI does not consume it; revisit
when the UI wants to show it.

### Settled

#### Where does advice live?

Beside the handler, in the rule's data. (2026-10-12) The handler already owns
the outcome taxonomy; the remedy for an outcome is that taxonomy's other half.

#### Configurable per rule?

Yes - the existing rule-override-by-name mechanism, wholesale replacement.
(2026-10-12)
