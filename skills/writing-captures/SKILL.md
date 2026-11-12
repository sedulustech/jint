---
name: writing-captures
description: >
  Add a capture to a jint grammar so a rule can target a construct that no shipped capture
  covers, such as a test case, a table, a heading or a group of statements. Use when a rule
  needs a unit jint does not extract, when `jint capture` lists no element for the construct,
  or when bringing a grammar of your own.
  Triggers: new capture, queries.scm, capture directive, target a construct, BYOG.
---

# Writing jint captures

A capture turns a syntax node into an element, and a rule targets elements. A rule cannot judge a
construct that no element covers, so a rule sometimes needs a new capture before it can work. The
reference pages are `jint docs captures`, `directives`, `grammars`, `byog` and `targets`.

## 1. Check that you need one

- Run `jint capture <file> --rule <rule>`. It lists, at no cost, the elements the rule would judge.
- Add a capture when the construct is missing from that list, or is hidden inside another element.
- Use a shared capture (`function`, `method`, `class`, `type`, `binding`, `comment`, `import`) when
  the construct is one of those: every target and shipped rule works on it unchanged.
- Use a capture of your own when the construct needs a target of its own. A rule targets it as
  `{grammar}:{capture}`, such as `typescript:test_case`.

## 2. Write the pattern

One pattern and one directive make a capture. The directive `capture.<name>.definition` makes it an
element, and a capture of your own must set it:

```scheme
; extends
((call_expression
  arguments: (arguments . (string) [(arrow_function) (function_expression)])) @test_case
  (#match? @test_case "^(test|it)(\\.[a-z]+)*\\(")
  (#set! "capture.test_case.definition" "true")
  (#set! "capture.test_case.opaque" "true"))
```

- Bind only the captures you mean to be elements. A helper capture such as `@_callee` fails at load.
  To test a name, a callee or a sibling count, match the text of the one captured node:
  `(#match? @test_case "...")`.
- The first line, `; extends`, adds your patterns to the grammar's own. Without it, the file
  replaces the grammar's queries whole.
- Directives are `capture.<name>.definition`, `opaque`, `selfNesting`, `absorbTail` and `merge`.
  Set each name once per file. `jint docs directives` lists them.

## 3. Try it before you install it

- `jint capture <file> --queries wip.scm` extracts with your file and installs nothing.
- To use it in a run, save it as `$JINT_GRAMMAR_DIR/<grammar>/queries.scm`, by default
  `~/.jint/grammars/<grammar>/`, next to an `extensions.json` such as `[".ts"]`. An embedded
  grammar's parser is reused. `jint docs byog` covers a grammar of your own.

## 4. Mind what else it changes

- **When two patterns match one node, the earlier one wins.** To carve a construct out of an existing
  capture, such as test calls that the TypeScript grammar captures as functions, put your pattern
  on the same node. Every other function stays a function.
- **A capture inside an opaque capture is hidden.** `function`, `method` and `binding` are opaque by
  default.
- **Do not set `capture.function.opaque` to `false` to expose your capture.** A directive applies to
  its capture name for the whole file. In one measured case it added hundreds of binding elements
  to ordinary source files that hold no tests. Make your capture claim the node instead.
- A directive you set replaces the same directive in the grammar's own file.

## 5. Check the blast radius

1. Run `jint capture` on files that hold the construct. The new elements appear, with the right
   spans and no stray interiors.
2. Run it on files that do not hold the construct, with and without your queries, and compare the
   output. It must not change. A difference means the capture reaches further than you meant.
3. Point a rule at `{grammar}:{capture}` and run `jint capture --rule <rule>` to see the units it
   will judge.
4. Test small on many kinds of file: a few that hold the construct, a few that do not.

## Never

- Change a shared capture's directive to make one construct visible: it changes every file of the
  grammar.
- Ship a capture you have only run on files that hold the construct.

## Feedback

If a step here is wrong, unclear or missing, open an issue at sedulustech/jint
(https://github.com/sedulustech/jint/issues). Say which step, what you did and what happened.
