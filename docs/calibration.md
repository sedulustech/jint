# Calibration

Calibration is testing a rule and editing it until it is right. A test is one rule version, run
two times on the same inputs. Compare tests by their undecided count. Undecided readings show
where the options do not separate the code.

When a rule has many undecided readings, edit its instructions or criteria. Do not change the
rule's action.

## Tests: is_comment_justified

Corpus `sdk`: 9 files in `packages/sdk/src/core`, 95 units. Each cell is `run 1 / run 2`.
All counts use `below: 1.5`.

| test | change                                                                              | error   | pass    | undecided | request                             |
| ---- | ----------------------------------------------------------------------------------- | ------- | ------- | --------- | ----------------------------------- |
| v5   | five options: sound, contradicted, wording_unmapped, about_surroundings, historical | 47 / 49 | 32 / 33 | 16 / 13   | [v5](calibration/v5.request.json)   |
| v9   | wording_unmapped includes a caller's or a format's vocabulary                       | 51 / 46 | 25 / 25 | 19 / 24   | [v9](calibration/v9.request.json)   |
| v10  | rename to justified, digression, provenance; a constraint is not a digression       | 54 / 52 | 21 / 22 | 20 / 21   | [v10](calibration/v10.request.json) |
| v11  | add narration; provenance becomes historical_events                                 | 47 / 48 | 24 / 24 | 24 / 23   | [v11](calibration/v11.request.json) |
| v12  | v10 options; provenance reworded                                                    | 50 / 50 | 26 / 27 | 19 / 18   | [v12](calibration/v12.request.json) |

v5 had no `undecided` handle. Its counts are read again at `below: 1.5`.

The same tests on other corpora, undecided readings only:

| test | app (65 units) | t3code (243 units) |
| ---- | -------------- | ------------------ |
| v10  | 17 / 20        | —                  |
| v11  | 18 / 20        | —                  |
| v12  | 20 / 17        | 82 / 84            |

`app` is `packages/app/src` (ts, tsx). `t3code` is `packages/contracts` in
[pingdotgg/t3code](https://github.com/pingdotgg/t3code).

Two runs of one test differ by up to 5 undecided readings. A difference between tests that is
smaller than that is noise.

## One unit across tests

Each request file holds both runs' jev exchanges for `unknownRuleError` in
`packages/sdk/src/core/lint.ts`. The pass tier holds one option, justified (sound in v5, v9).

| test | run 1: pass / error mass | run 2: pass / error mass | reading                 |
| ---- | ------------------------ | ------------------------ | ----------------------- |
| v5   | 0.57 / 0.43              | 0.54 / 0.46              | undecided               |
| v9   | 0.59 / 0.41              | 0.47 / 0.53              | undecided; tier changes |
| v10  | 0.58 / 0.42              | 0.57 / 0.43              | undecided               |
| v11  | 0.47 / 0.53              | 0.52 / 0.48              | undecided; tier changes |
| v12  | 0.58 / 0.42              | 0.52 / 0.48              | undecided               |

No test decides this unit. In each test, most of the error mass is on wording_unmapped.
