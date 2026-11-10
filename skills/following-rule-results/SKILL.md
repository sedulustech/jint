---
name: following-rule-results
description: >
  Run jint on a path and resolve its findings. Use when measuring code or prose
  (markdown, text) for quality, naming, or comments and fixing what jint flags.
  Triggers: jint, semantic lint.
---

# jint - run it, fix what it flags

jint measures code and prose with AI-classifier judgments. A finding carries a severity and, for
most rules, a fixer message that states the exact fix.

The docs ship with the CLI: `jint docs` lists them and `jint docs <name>` prints one. Every flag
is in `jint --help`.

## Run it

- jint runs only the rules a config names. With none it exits 2 and prints the rules and a working
  example: write `jint.config.ts` from that list. The API key goes in the environment (`jint docs
endpoints`).
- A path: `jint run <path>`. One element: `jint run <path>@L<line> --rule <rule>`. The CLI echoes
  the element it captured: check it is the one you mean.
- A changeset: `git diff --name-only | jint run paths -`.
- Anchors are pre-edit. After any edit, grep the declaration again and re-run.
- Exit 1 is an error finding, 2 a setup problem, 4 an input that was not fully measured.
- A report with `run.answersFromCache` above zero and no usage was answered from the cache: nothing
  was asked again. `--no-cache` asks again.
- Every run costs spend. Run one file to find findings, then one element to verify a fix.

## Fix loop

1. Re-query one finding: `jint run <path>@L<line> --rule <rule>`.
2. Check the echoed element is the finding's target.
3. Do exactly what the fixer message says. Do not soften it, fork it or improve on it.
4. Edit the source file. A capture or a request dump is what was judged, not the file.
5. Re-anchor, re-query, and confirm the finding is gone.

## Never

- Edit a rule, its thresholds, the scope or the engine to make a finding pass. A change to a rule
  is its own item for the user to review.
- Work around a finding you think is wrong. Report it and stop.
- Read thresholds or scores. Act on the severity and the message.
