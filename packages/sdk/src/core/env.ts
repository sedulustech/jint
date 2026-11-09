/**
 * The environment variables jint reads, the one list the reference page is generated from. The
 * guard test keeps it whole: a variable the source reads that is not here, and not named as
 * internal in that test, fails the suite.
 */

export interface EnvVar {
  readonly name: string;
  /** What a run uses when the variable is unset. */
  readonly default: string;
  readonly meaning: string;
}

export const ENV_VARS: readonly EnvVar[] = [
  {
    name: "OPENAI_API_KEY",
    default: "none",
    meaning: "The key for `api.openai.com`. jint sends it nowhere else.",
  },
  {
    name: "JINT_API_URL",
    default: "OpenAI's Decisions API",
    meaning:
      "The endpoint. Its last segment names the wire. See [models and endpoints](../endpoints.md).",
  },
  {
    name: "JINT_API_KEY",
    default: "none",
    meaning: "The key for the url in `JINT_API_URL`. It wins over `OPENAI_API_KEY`.",
  },
  {
    name: "JINT_API_MODEL",
    default: "`gpt-6-luna` on `/decisions`",
    meaning: "The model to ask. A `/v1/systemone` server needs it, except TypeSafe's own host.",
  },
  {
    name: "JINT_RUNS_DIR",
    default: "`~/.jint/runs`",
    meaning: "The directory where jint records runs.",
  },
  {
    name: "JINT_CACHE_DIR",
    default: "`~/.jint/cache`",
    meaning: "The directory of the answer cache.",
  },
  {
    name: "JINT_GRAMMAR_DIR",
    default: "`~/.jint/grammars`",
    meaning: "The directory of custom grammars.",
  },
  {
    name: "JINT_UI_HOST",
    default: "`127.0.0.1`",
    meaning: "The host that `jint serve` binds. Give a host, not `host:port`.",
  },
  {
    name: "JINT_UI_PORT",
    default: "a free port",
    meaning: "The port that `jint serve` binds.",
  },
  {
    name: "JINT_LOG_LEVEL",
    default: "`off`",
    meaning: "The log level on stderr: `debug`, `info`, `warn`, `error` or `off`.",
  },
];
