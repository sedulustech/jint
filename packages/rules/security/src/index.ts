/** Security rules: what a file must not hold. */

import type { NoulRuleSchema, RuleSchema } from "@jint/contract";

/**
 * A secret or personal value in plain text in a data file. Calibrated with planted controls in
 * copies of real files, never a real leak, so the defective side is synthetic. Per language, the
 * lowest planted secret against the highest decoy: json 1.0 / 0, toml 0.99 / 0.09, yaml 1.0 / 0.
 * The decoys are references (`${{ secrets.X }}`, `${ENV}`), placeholders (`<your-api-key>`,
 * `changeme`, an empty value) and a secret-file path. 0 of 48 real config files in this repo fire.
 */
export const has_sensitive_value: NoulRuleSchema = {
  name: "has_sensitive_value",
  instructions:
    "This unit is one configuration or data file. Does it hold a real secret or personal value written in plain text: a credential, key, token, password or private key, or personal data such as an email address, phone number or home address?",
  criteria: {
    true: "At least one value is a live-looking secret or personal datum written in the file: an API key or token with a vendor prefix or high-entropy body, a password, a private key block, a connection string with embedded credentials, an access key pair, or a real person's contact details. A key NAME alone does not count; the value must be present and look real.",
    false:
      "No value is a secret or personal datum: values are placeholders (changeme, <token>, ${ENV_VAR}, an empty string), references to a secret store or environment variable, public identifiers (a package name, a url without credentials, a hash of public content, a version), or example data that is plainly fake.",
  },
  target: "files",
  include: ["**/*.json", "**/*.jsonc", "**/*.toml", "**/*.yaml", "**/*.yml"],
  handle: {
    warn: { greater_than: 0.5 },
    error: {
      greater_than: 0.8,
      message:
        "Remove the secret from the file and rotate it: read it from the environment or a secret store.",
    },
  },
};

/** Every rule of this domain, in run order. */
export const rules: readonly RuleSchema[] = [has_sensitive_value];
