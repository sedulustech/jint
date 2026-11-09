import pkg from "../../package.json";

/** Set at compile time by scripts/build.ts for a beta build (`beta-<sha6>`); absent everywhere else. */
declare const JINT_BUILD_VERSION: string | undefined;

/**
 * The version of this jint: what `--version` prints and what a report says. One source, so a beta
 * binary names itself the same way in both.
 */
export const VERSION: string =
  typeof JINT_BUILD_VERSION === "string" ? JINT_BUILD_VERSION : pkg.version;
