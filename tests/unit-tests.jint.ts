/**
 * Rules for the repo's unit tests, which live in packages/ next to their source. A unit test runs
 * in one process: one that spawns a process or serves real HTTP is an end-to-end test and belongs
 * in this directory.
 *
 * Has_wrong_level, over every unit test in packages/ (typescript:test_case, 12 flagged of 673): all
 * 12 spawn a process or serve real requests, and the rest read 0.00. A planted control, a real unit
 * test with a spawn added, reads 0.9 or higher.
 *
 * Other languages, with the rule on go:test_case and python:test_case (Go 4 test files with 10
 * tests, Python 5 files with 48): healthy tests read 0.00 in Go and 0.01 or lower in Python, and
 * every test that spawns a process or forks reads 0.93 or higher in Go and 1.00 in Python (execabs,
 * script_helper, wait3, select). The 0.6 threshold sits inside both gaps. A test that sends live
 * HTTP through a helper outside its own text still reads low (0.24 and 0.49 earlier): the model
 * sees only the unit. That miss, and one small corpus per language, keep the rule out of a default
 * set.
 */

import type { RuleSchema } from "jint:sdk";

export const should_be_e2e: RuleSchema = {
  name: "should_be_e2e",
  target: "typescript:test_case",
  include: ["packages/**/*.test.ts"],
  instructions:
    "Does this test cross a process or network boundary, which makes it an end-to-end test and not a unit test?",
  criteria: {
    true: "The test spawns a child process or runs the CLI binary, or starts a real server and sends real HTTP requests to it, or opens real sockets. Its setup is the running system and not a function call. A child process that only reads repository state for the test, such as git ls-files, is a tool and not the system under test.",
    false:
      "The test calls functions or classes in its own process: with in-memory inputs, with fakes standing in for the network, or with files and directories created on disk as inputs or fixtures. It may run a helper such as git ls-files to read repository state.",
  },
  handle: {
    error: {
      greater_than: 0.6,
      message:
        "Move this test to an end-to-end test in the e2e tests root dir and delete the unit test.",
    },
  },
};

export const rules: readonly RuleSchema[] = [should_be_e2e];
