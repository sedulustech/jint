---
name: jint-follow
description: >
  Run jint on a path and resolve its findings. Use when measuring code quality,
  naming, or comments and fixing what jint flags. Triggers: jint, jev lint.
---

<!-- Generated - do not edit. Regenerate with: bun run schema -->

# jint - run it, fix what it flags

jint measures code with AI-classifier judgments and prints findings: a severity
and, for most rules, a fixer message that states the exact fix.

## Run it

Install: https://github.com/sedulustech/jint#install.
The API key (`JINT_API_KEY` or `OPENAI_API_KEY`, or `apiKey` in the config) must be in
the environment. Every flag, including output
formats and scoping, lives in `jint --help` - the tool's own contract, not
duplicated here.

A whole path: `jint run <path>`. One element: `jint run <path>@L<line> --rule
<rule>`. The CLI echoes which element an @L selector captured - verify that
element is the one you mean before fixing anything.

Anchors are PRE-EDIT. `@L<n>` names the line the run saw, not the line that
exists now. After any edit, re-anchor: grep the declaration, re-run.

## Read the findings

A finding carries a severity and a fixer message. Severity + message is the
whole actionable surface - not the schema, not thresholds, not score numbers.

The canonical fixer message per rule (rendered from the same tables the CLI
uses, so this cannot drift from the messages you will see):

| rule                     | severity | fixer message                                                                        |
| ------------------------ | -------- | ------------------------------------------------------------------------------------ |
| `is_comment_narration`   | error    | Remove this comment.                                                                 |
| `will_comment_drift`     | error    | Remove this comment.                                                                 |
| `is_cognitively_complex` | error    | Decompose this function: extract readable named steps so the main body reads easily. |

A finding without a row above carries no fixer message; the finding's own text
is the instruction.

## Spend

Every run costs classifier spend. Measure the smallest surface that answers
the question.

- Fixing one finding: re-run scoped to that element (`path@L<line>`), not the
  file, not the tree.
- Working in one file: run that file, not the directory.
- A full run is for discovering findings; scoped runs are for verifying a fix.

## The fix loop

1. Take a finding. Re-query just that unit:
   `jint run <path>@L<line> --rule <rule>`. One query, one unit, one verdict.
2. Read the element the CLI echoed. Verify it is the finding's target.
3. Execute the fixer message EXACTLY. The message is canonical - do not
   interpret, soften, or improve on it. Do not fork: no partial fix, no
   rewording that leaves the flagged thing in place.
4. Edit the source file itself. Captures and request dumps record what was
   judged, not how the file is written now; their indentation is not source.
5. Re-anchor at the current line and re-query to confirm the finding is gone.

## Hard rules

- Never edit rules, thresholds, the engine, or config to make a finding pass.
- If you believe a finding is wrong, report it and stop. Do not work around it.
- Do not read the schema, thresholds, or score numbers. Severity + message is
  all you act on.
