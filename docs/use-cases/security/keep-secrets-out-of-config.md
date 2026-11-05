---
title: "Keep secrets out of config"
description: "A rule for data files: it finds a secret or personal value written in plain text in a json, toml or yaml file."
sidebar:
  label: Keep secrets out of config
---

# Keep secrets out of config

`has_sensitive_value` finds a secret or personal value written in plain text in a json, toml or yaml file. A reference to the environment or a secret store passes.

```ts
import type { RuleSchema } from "jint:sdk";

const has_sensitive_value: RuleSchema = {
  name: "has_sensitive_value",
  kind: "noul",
  target: "files",
  include: ["**/*.json", "**/*.jsonc", "**/*.toml", "**/*.yaml", "**/*.yml"],
  instructions:
    "This unit is one configuration or data file. Does it hold a real secret or personal value written in plain text: a credential, key, token, password or private key, or personal data such as an email address, phone number or home address?",
  criteria: {
    true: "At least one value is a live-looking secret or personal datum written in the file: an API key or token with a vendor prefix or high-entropy body, a password, a private key block, a connection string with embedded credentials, an access key pair, or a real person's contact details. A key NAME alone does not count; the value must be present and look real.",
    false:
      "No value is a secret or personal datum: values are placeholders (changeme, <token>, ${ENV_VAR}, an empty string), references to a secret store or environment variable, public identifiers (a package name, a url without credentials, a hash of public content, a version), or example data that is plainly fake.",
  },
  handle: {
    warn: { greater_than: 0.5 },
    error: {
      greater_than: 0.8,
      message:
        "Remove the secret from the file and rotate it: read it from the environment or a secret store.",
    },
  },
};
```
