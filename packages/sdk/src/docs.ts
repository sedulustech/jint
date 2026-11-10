/**
 * The docs that ship with jint: the repo's docs/ pages, embedded in the package (and in the
 * compiled binary) as text, so an agent with only the CLI reads the same pages the site shows.
 * `docs/designs` stays out: those are notes, not pages. A guard test fails when a page is neither
 * embedded here nor left out on purpose.
 */

import docByog from "../../../docs/byog.md" with { type: "text" };
import docCalibration from "../../../docs/calibration.md" with { type: "text" };
import docCaptures from "../../../docs/captures.md" with { type: "text" };
import docConfidence from "../../../docs/confidence.md" with { type: "text" };
import docConfig from "../../../docs/config.md" with { type: "text" };
import docDirectives from "../../../docs/directives.md" with { type: "text" };
import docEndpoints from "../../../docs/endpoints.md" with { type: "text" };
import docGrammars from "../../../docs/grammars.md" with { type: "text" };
import docHowToUse from "../../../docs/how-to-use.md" with { type: "text" };
import docInstall from "../../../docs/install.md" with { type: "text" };
import docLocal from "../../../docs/local.md" with { type: "text" };
import docReferenceCli from "../../../docs/reference/cli.md" with { type: "text" };
import docReferenceConfig from "../../../docs/reference/config.md" with { type: "text" };
import docReferenceEnvironment from "../../../docs/reference/environment.md" with { type: "text" };
import docReplacingCodeReviews from "../../../docs/replacing-code-reviews.md" with { type: "text" };
import docTargets from "../../../docs/targets.md" with { type: "text" };
import docUseCasesBashRemoveStaleComments from "../../../docs/use-cases/bash/remove-stale-comments.md" with { type: "text" };
import docUseCasesCssUsePaletteColors from "../../../docs/use-cases/css/use-palette-colors.md" with { type: "text" };
import docUseCasesDocsKeepUseCasesShort from "../../../docs/use-cases/docs/keep-use-cases-short.md" with { type: "text" };
import docUseCasesOpengraphNameThePageInItsTitle from "../../../docs/use-cases/opengraph/name-the-page-in-its-title.md" with { type: "text" };
import docUseCasesReactAlwaysNameEffects from "../../../docs/use-cases/react/always-name-effects.md" with { type: "text" };
import docUseCasesSecurityKeepSecretsOutOfConfig from "../../../docs/use-cases/security/keep-secrets-out-of-config.md" with { type: "text" };
import docUseCasesSeoNameThePageForSearchResults from "../../../docs/use-cases/seo/name-the-page-for-search-results.md" with { type: "text" };
import docUseCasesTypescriptRewriteStatefulComments from "../../../docs/use-cases/typescript/rewrite-stateful-comments.md" with { type: "text" };
import docWhatAreRules from "../../../docs/what-are-rules.md" with { type: "text" };
import docWhatIsJint from "../../../docs/what-is-jint.md" with { type: "text" };

/** Each embedded doc: its name (the path under docs/, without .md) and its markdown. */
export const DOC_FILES: Readonly<Record<string, string>> = {
  byog: docByog,
  calibration: docCalibration,
  captures: docCaptures,
  confidence: docConfidence,
  config: docConfig,
  directives: docDirectives,
  endpoints: docEndpoints,
  grammars: docGrammars,
  "how-to-use": docHowToUse,
  install: docInstall,
  local: docLocal,
  "replacing-code-reviews": docReplacingCodeReviews,
  targets: docTargets,
  "what-are-rules": docWhatAreRules,
  "what-is-jint": docWhatIsJint,
  "reference/cli": docReferenceCli,
  "reference/config": docReferenceConfig,
  "reference/environment": docReferenceEnvironment,
  "use-cases/bash/remove-stale-comments": docUseCasesBashRemoveStaleComments,
  "use-cases/css/use-palette-colors": docUseCasesCssUsePaletteColors,
  "use-cases/docs/keep-use-cases-short": docUseCasesDocsKeepUseCasesShort,
  "use-cases/opengraph/name-the-page-in-its-title": docUseCasesOpengraphNameThePageInItsTitle,
  "use-cases/react/always-name-effects": docUseCasesReactAlwaysNameEffects,
  "use-cases/security/keep-secrets-out-of-config": docUseCasesSecurityKeepSecretsOutOfConfig,
  "use-cases/seo/name-the-page-for-search-results": docUseCasesSeoNameThePageForSearchResults,
  "use-cases/typescript/rewrite-stateful-comments": docUseCasesTypescriptRewriteStatefulComments,
};

/** The front matter of a doc is the site's; the body is what a reader wants. */
function bodyOf(markdown: string): string {
  return markdown.replace(/^---\n[\s\S]*?\n---\n+/, "");
}

function fieldOf(markdown: string, field: string): string {
  const match = markdown.match(new RegExp(`^${field}: "?(.*?)"?$`, "m"));
  return match?.[1] ?? "";
}

/** Every embedded doc with its one-line description, in name order. */
export function listDocs(): { name: string; description: string }[] {
  return Object.entries(DOC_FILES).map(([name, markdown]) => ({
    name,
    description: fieldOf(markdown, "description"),
  }));
}

/** One doc's body by name (`config`, `reference/cli`), or null when there is none. */
export function readDoc(name: string): string | null {
  const markdown = DOC_FILES[name.replace(/\.md$/, "")];
  return markdown === undefined ? null : bodyOf(markdown);
}
