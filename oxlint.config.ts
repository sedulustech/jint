import { defineConfig } from "oxlint";

export default defineConfig({
  options: { typeAware: true },
  jsPlugins: ["./.oxlint/anti-slop/index.ts"],
  plugins: ["jest"],
  rules: {
    "no-empty": "warn",
    "no-console": "deny",
    "no-unused-vars": "deny",
    "no-explicit-any": "deny",
    "no-non-null-assertion": "deny",
    "no-empty-pattern": "warn",
    "no-useless-escape": "warn",
    "preserve-caught-error": "deny",
    "import/no-duplicates": "deny",
    "promise/always-return": "warn",
    "promise/catch-or-return": "warn",
    "typescript/no-non-null-assertion": "deny",
    "typescript/no-require-imports": "deny",
    "typescript/no-explicit-any": "deny",
    "sort-keys": "off",
    "sort-vars": "deny",
    "no-inline-comments": "deny",
    "arrow-body-style": "deny",
    "unicorn/no-nested-ternary": "deny",
    "anti-slop/no-conditional-empty-object-spread": "deny",
    "default-case": "deny",

    "typescript/no-floating-promises": "deny",
    "typescript/await-thenable": "deny",
    "typescript/no-meaningless-void-operator": "deny",

    "typescript/no-misused-promises": "deny",
    "typescript/consistent-type-imports": "deny",
    "typescript/consistent-type-assertions": "deny",
    "typescript/no-inferrable-types": "deny",
    "typescript/prefer-return-this-type": "deny",
    "typescript/prefer-function-type": "deny",

    "typescript/unbound-method": "off",
  },
  ignorePatterns: ["**/node_modules", "**/tmp", "**/probes", "**/*.d.ts", "**/fixtures/**"],
  overrides: [
    {
      // src/logger.ts is the single console.* choke point (structured stderr
      // logger); see typescript/logging.md - the ban applies everywhere else.
      files: ["src/logger.ts", "packages/cli/src/logger.ts"],
      rules: { "no-console": "off" },
    },
    {
      // build scripts are CLI tools themselves: console is their output channel
      files: ["scripts/**"],
      rules: { "no-console": "off" },
    },
    {
      files: ["**/*.test.ts", "**/*.spec.ts"],
      rules: {
        "jest/expect-expect": "deny",
        "jest/valid-expect": "deny",
        "jest/no-conditional-expect": "deny",
        "jest/no-disabled-tests": "deny",
        "jest/no-focused-tests": "deny",
        "jest/no-identical-title": "deny",
        "jest/no-standalone-expect": "deny",
        "jest/no-duplicate-hooks": "deny",
        "jest/require-to-throw-message": "deny",
        "jest/valid-title": "deny",
        "jest/no-conditional-in-test": "off",
        "no-console": "off",
        "no-non-null-assertion": "off",
        "typescript/no-non-null-assertion": "off",
        "sort-keys": "off",
        "no-inline-comments": "off",
        "no-unused-vars": [
          "deny",
          { caughtErrors: "none", argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
        ],
      },
    },
  ],
});
