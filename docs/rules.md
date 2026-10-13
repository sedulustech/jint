---
title: Rules
description: The default rule set, rendered from the default rules. Generated - do not edit.
---

# Default rules

Rendered verbatim from the spec package (@jint/defaults). Instructions are the yes/no question the classifier answers per element; criteria pins what each answer means; the target is the element role the rule judges; the handle turns readings into findings. Editing any of these in the specs is a recalibration event. Regenerate: `bun run schema`.

## `is_name_purposeful`

| kind   | target      | handle                         |
| ------ | ----------- | ------------------------------ |
| choice | definitions | score map: pass → warn → error |

**Instructions.** Count this unit's identifiers whose names fail to state what the thing does or holds. A failing name names the implementation instead of the purpose, is a bare generic word that could label anything (data, handler, util, temp), or misleads by promising behavior or a kind the thing does not have. Casing and convention style are not part of this judgment.

**Score 0.** No violations: every identifier's name states what it does or holds - a reader can infer each thing's purpose from the name alone, without reading the surrounding code.

**Score 1.** One violation: exactly one identifier's name hides its purpose - it names how the code works rather than what it is for, is a bare generic word, or misleads.

**Score 2.** Several violations: more than one identifier's name hides its purpose in any of these ways.

## `is_vocabulary_consistent`

| kind | target | handle                                   |
| ---- | ------ | ---------------------------------------- |
| noul | files  | warn less than 0.75, error less than 0.6 |

**Instructions.** Do the identifiers in this change keep one vocabulary - the same concept always the same word?

**True.** The new identifiers in this change keep one vocabulary with each other and with the names the change touches: the same concept always keeps the same word, and the same role keeps the same suffix or verb convention.

**False.** Synonym drift is present: the same concept is referred to by two different words within the same change (user in one place, account for the same thing in another; cart versus basket), forcing a reader to learn two names for one idea. Different words for genuinely different concepts are not drift.

## `is_naming_convention_consistent`

| kind | target      | handle                                    |
| ---- | ----------- | ----------------------------------------- |
| noul | definitions | warn less than 0.75, error less than 0.65 |

**Instructions.** Do identifiers of the same kind in this unit follow a single casing convention?

**True.** Identifiers of the same kind follow one casing convention - functions and variables in camelCase, types and classes in PascalCase, module-level constants in SCREAMING_SNAKE - or whichever single form the surrounding code has already established for that kind.

**False.** Two different casing forms appear for the same kind within the change or module (getUserData beside fetch_user_data for two functions, OrderItem beside order_item for two types), forcing a reader to learn two shapes for one kind. Different kinds may use different conventions, and word choice or name quality are not casing failures.

## `is_greppable`

| kind | target    | handle                                   |
| ---- | --------- | ---------------------------------------- |
| noul | functions | warn less than 0.75, error less than 0.6 |

**Instructions.** Are the identifiers in this function searchable with terms a developer would use to find this code?

**True.** The code identifiers judged here are those in the function's declaration and body - its own name, its parameters, its locals, and the names it reads - and they are greppable: written out in full at every occurrence, never split into fragments or dynamically constructed from pieces, never renamed at a boundary, and specific enough that a search hit is genuinely a reference to this thing.

**False.** At least one identifier in the function cannot be found by a single search: it is split into fragments or dynamically constructed from pieces, renamed at a boundary so the same concept needs two search strings, or is a bare word (data, handler, util) whose hits are mostly noise. CLI flag spellings, help text, and log messages are user-facing interface, not code identifiers, and are outside this rule.

## `is_filename_fitting`

| kind | target | handle                                          |
| ---- | ------ | ----------------------------------------------- |
| noul | files  | warn greater than 0.55, error greater than 0.75 |

**Instructions.** Does this file's name promise a subject its body does not deliver - a name whose dominant content answers to a different responsibility?

**True.** The file name promises one subject but the body delivers a different one: the dominant content of the file - its main exports and the logic around them - belongs to a subject the name does not name or names differently (json.ts whose body renders HTML reports, walker.ts whose body parses config files). Judge the basename of the state path, using the directory path only for context; a name may state a role or verb (load, parse, classify, render) and then matches a body whose dominant action is that verb. Judge by the dominant responsibility, not incidental helpers: a small shared helper inside the file is not a mismatch. Generic names (utils, helpers, types, common, index) are exempt from being called too broad, but if a generic name hides one specific subject and the body contradicts that subject, that is a mismatch. Barrel files that only re-export, and test files, are exempt unless they contradict their name.

**False.** The file name and the body agree: the name names the subject of the main exports, or states the verb/role the body's dominant action performs, or the name is a deliberate generic (utils, helpers, types, index) whose body is ordinary mixed helpers, or the file is a barrel/test file consistent with its name. A name being merely vague or the code being poorly written is not this defect: answer false.

## `is_comment_narration`

| kind | target   | handle                                         |
| ---- | -------- | ---------------------------------------------- |
| noul | comments | warn greater than 0.3, error greater than 0.45 |

**Instructions.** Does any comment in this unit merely restate what the code in this unit already says, so that removing it loses nothing a reader could not get from the code itself?

**True.** At least one comment merely narrates the code: it restates what the code already says - translating statements into prose, echoing the identifier's own name, or annotating the obvious (an increment, an assignment, a return) - so removing it loses nothing a reader could not get from the code itself.

**False.** Every comment here says something the code cannot: it states why the code exists, records a constraint, or flags a non-obvious trap.

## `is_comment_patching_readability`

| kind | target   | handle                                         |
| ---- | -------- | ---------------------------------------------- |
| noul | comments | warn greater than 0.4, error greater than 0.55 |

**Instructions.** Does any comment here patch code that should read itself, instead of the code being made readable?

**True.** At least one comment exists to explain code that should read itself - patching dense expressions, tangled control flow, or misleading names with prose instead of the code being made readable. This is a code smell: the fix is rewriting the code, and the comment makes the confusion livable so the rewrite never happens.

**False.** Every comment earns its place by carrying what code cannot: rationale, constraints, or external contracts. Comments that add what code cannot carry are not readability patches, even when the surrounding code is also hard to read.

## `will_comment_drift`

| kind | target   | handle                                         |
| ---- | -------- | ---------------------------------------------- |
| noul | comments | warn greater than 0.55, error greater than 0.7 |

**Instructions.** Does any comment pin specific artifacts by name such that renaming or removing them silently invalidates the comment?

**True.** At least one comment pins specific artifacts by name - files, functions, parameters, constants, types, paths - such that renaming or removing that artifact silently invalidates the comment while the code keeps working. The claim is coupling between the comment's wording and identifiers, not comments already wrong today.

**False.** No comment here is coupled to specific artifacts by name: every comment describes behavior, rationale, or constraints without pinning identifiers, so renaming or removing code can never silently invalidate it.

## `will_error_lose_cause`

| kind | target    | handle                                        |
| ---- | --------- | --------------------------------------------- |
| noul | functions | warn greater than 0.4, error greater than 0.7 |

**Instructions.** Does this function's error handling lose information about the original failure?

**True.** Error handling loses information: a caught error is swallowed, rethrown without its cause, or replaced by a message that drops the original failure detail.

**False.** Error handling preserves information: causes are chained, messages include the original failure detail, and nothing is swallowed silently.

## `is_cognitively_complex`

| kind   | target      | handle                         |
| ------ | ----------- | ------------------------------ |
| choice | definitions | score map: pass → warn → error |

**Instructions.** How much EFFORT does a reader need to follow this code's logic - effort caused by structure the author chose, not by the problem itself? Ignore length alone: a long linear unit with one job reads as easy. Ignore inherent complexity: cases the data or the domain genuinely force are not this failure. Judge how hard the code's own structure makes it to read top-to-bottom.

**Score 0.** Easy: the logic reads top-to-bottom. A single pass suffices. Any difficulty present is inherent to the problem, not to the structure.

**Score 1.** Moderate: the reader must pause once or twice - hold a small amount of state across a few lines, or re-check an outer condition - but the structure is otherwise linear and the full flow is recoverable by re-reading one or two spots.

**Score 2.** Hard: following the code requires actively reconstructing its flow - a stack of nested conditions to track, several unrelated concerns fused into one unit, state held across many lines, or an order that forces jumps instead of top-to-bottom reading. The structural difficulty could be removed without changing what the code does.

## `is_function_srp`

| kind | target    | handle                                   |
| ---- | --------- | ---------------------------------------- |
| noul | functions | warn less than 0.45, error less than 0.3 |

**Instructions.** Does this unit serve a single cohesive responsibility, every step serving one stated purpose?

**True.** The unit performs one cohesive responsibility: all its steps serve a single purpose its name and docblock state.

**False.** There is more than one reason for the unit to change: it mixes business logic, data validation, and side effects.
