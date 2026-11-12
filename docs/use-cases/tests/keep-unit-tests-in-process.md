---
title: "Keep unit tests in one process"
description: "A rule that reads each unit test and flags the ones that spawn a process or serve real requests, so they move to end-to-end tests."
sidebar:
  label: Unit tests
---

# Keep unit tests in one process

[`should_be_e2e`](../../../tests/unit-tests.jint.ts) flags a unit test that spawns a process or serves real requests: it is an end-to-end test in the wrong place.

```ts
import type { RuleSchema } from "jint:sdk";

const should_be_e2e: RuleSchema = {
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
```
