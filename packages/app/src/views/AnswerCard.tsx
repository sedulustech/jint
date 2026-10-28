import {
  asTier,
  choiceTierMass,
  readChoice,
  type ChoiceHandlerData,
  type HandlerLevel,
} from "@jint/contract";
import { SEVERITY, TIER } from "./color";
import { LabeledText, SectionHeading } from "./LabeledText";

export interface QA {
  key: string;
  rule: string;
  /**
   * Criteria: {true, false} for noul, option label -> meaning for choice, the level texts in order
   * for score (an array: its index is the level).
   */
  question: {
    type?: string;
    instructions?: string;
    criteria?: Record<string, string> | readonly string[];
  };
  answer?: {
    type?: string;
    noul?: number;
    score?: number;
    choice?: string;
    confidence?: number;
    legend?: Record<string, string>;
    probabilities?: Record<string, number>;
  };
}

/**
 * One question = its criteria side by side + its LARGE answer. Score answers render the rounded
 * index as the protagonist plus the legend and the probability distribution (neutral bars - shape,
 * not verdict); choice answers render the verdict their tier read reached - each option's
 * probability summed into its tier - with the winning tier's bars in its color, keyed by label;
 * verdict color comes only from the card's own span-aware severity, never from a sibling
 * element's.
 */
type Threshold = { greater_than?: number; less_than?: number };

/** The noul gates from the run manifest, so a reading reads against its own thresholds. */
function thresholdText(threshold: Threshold | undefined): string | null {
  if (threshold === undefined) return null;
  if (threshold.greater_than !== undefined) return `> ${threshold.greater_than}`;
  if (threshold.less_than !== undefined) return `< ${threshold.less_than}`;
  return null;
}

export function AnswerCard({
  qa,
  sev,
  handle,
  choices,
}: {
  qa: QA;
  sev: "error" | "warn" | null;
  handle?: { warn?: Threshold; error?: Threshold };
  /** The choice rule's handle: each option's tier, so the card can show the tier read. */
  choices?: ChoiceHandlerData;
}) {
  const refused = qa.answer?.type === "refusal";
  const noul = qa.answer?.noul;
  const score = qa.answer?.score;
  const isScore = qa.answer?.type === "score" || (noul === undefined && score !== undefined);
  // a refused score or choice question has no answer to rank: its criteria list plainly
  const isNoulQuestion = qa.question.type === undefined || qa.question.type === "noul";
  const index = isScore && score !== undefined ? Math.round(score) : null;
  const choice = qa.answer?.type === "choice" ? qa.answer.choice : undefined;
  const isChoice = choice !== undefined;
  // the answered option: a score's rounded level, or the selected choice label
  const answeredKey = isChoice ? choice : index !== null ? String(index) : null;
  const ranked = isScore || isChoice;
  // the legend is the rule's own text, read from the question: a model may not echo it back
  const legend: Record<string, string> = ranked ? { ...qa.question.criteria } : {};
  const probabilities = ranked ? (qa.answer?.probabilities ?? {}) : {};
  // verdict color ONLY from severity; an unprovable answer stays neutral
  const color = sev !== null ? SEVERITY[sev].text : "text-foreground";
  // score levels sort numerically; choice options keep the question's own order
  const options = Object.keys({ ...legend, ...probabilities });
  if (isScore) options.sort((x, y) => Number(x) - Number(y));
  // the choice tier read: the verdict is the tier holding the most probability, not the provider's pick
  const tierRead =
    isChoice && choices !== undefined
      ? (() => {
          const mass = choiceTierMass(choices, probabilities);
          const fired = readChoice(choices, choice, probabilities);
          const tierOf = (k: string): HandlerLevel | undefined =>
            choices.choices[k] === undefined ? undefined : asTier(choices.choices[k]).level;
          const verdict: HandlerLevel | "undecided" = fired?.undecided
            ? "undecided"
            : (fired?.severity ?? "pass");
          // the sum that set a tier's mass, for the hover on each of its bars
          const sum = (tier: HandlerLevel): string => {
            const parts = options.filter((k) => tierOf(k) === tier);
            const terms = parts.map((k) => `${k} ${(probabilities[k] ?? 0).toFixed(2)}`);
            return `${tier}: ${terms.join(" + ")}${parts.length > 1 ? ` = ${mass[tier].toFixed(2)}` : ""}`;
          };
          // the rule's tiers in one fixed order, so every card's caption reads the same way
          const tiers = (["error", "warn", "pass"] as const).filter((t) =>
            options.some((k) => tierOf(k) === t),
          );
          return { mass, verdict, tierOf, sum, tiers };
        })()
      : null;
  // the emphasized options: the verdict tier's options under a tier read, else the answered one
  const emphasized = (k: string): boolean =>
    tierRead !== null ? tierRead.verdict === tierRead.tierOf(k) : k === answeredKey;
  return (
    <div>
      <div className="flex items-center gap-sections border-b border-border px-rail py-siblings">
        {/* a narrow pane moves the caption under the answer whole, never breaking it */}
        {refused && (
          <span
            data-testid="answer-refused"
            className="text-3xl font-bold leading-none text-muted-foreground"
          >
            refused
          </span>
        )}
        {noul !== undefined && (
          <span className="flex flex-wrap items-baseline gap-siblings">
            <span
              data-answer={noul.toFixed(2)}
              className={`text-3xl font-bold leading-none ${color}`}
              title={sev !== null ? `severity: ${sev}` : undefined}
            >
              {noul.toFixed(2)}
            </span>
            {handle !== undefined && (
              <span
                data-testid="noul-thresholds"
                className="whitespace-nowrap text-caption text-muted-foreground"
              >
                {["warn", "error"]
                  .map((level) => {
                    const text = thresholdText(handle[level as "warn" | "error"]);
                    return text === null ? null : `${level} ${text}`;
                  })
                  .filter((part) => part !== null)
                  .join(" \u00b7 ")}
              </span>
            )}
          </span>
        )}
        {isScore && index !== null && (
          <span className="flex flex-wrap items-baseline gap-siblings">
            <span
              data-answer={String(index)}
              className={`text-3xl font-bold leading-none ${color}`}
              title={sev !== null ? `severity: ${sev}` : undefined}
            >
              {index}
            </span>
            <span className="whitespace-nowrap text-caption text-muted-foreground">
              score {qa.answer?.score?.toFixed(2)}
              {qa.answer?.confidence !== undefined && (
                <span data-testid="answer-confidence">
                  {` \u00b7 confidence ${qa.answer.confidence.toFixed(2)}`}
                </span>
              )}
            </span>
          </span>
        )}
        {isChoice && (
          <span className="flex flex-wrap items-baseline gap-siblings">
            <span
              data-answer={choice}
              data-verdict={tierRead?.verdict}
              className={`text-3xl font-bold leading-none ${
                tierRead?.verdict === "pass" ? "text-sev-clean" : color
              }`}
              title={sev !== null ? `severity: ${sev}` : undefined}
            >
              {tierRead?.verdict ?? choice}
            </span>
            <span className="whitespace-nowrap text-caption text-muted-foreground">
              {tierRead !== null
                ? tierRead.tiers.map((t) => `${t} ${tierRead.mass[t].toFixed(2)}`).join(" vs ")
                : `p ${(probabilities[choice] ?? 0).toFixed(2)}`}
              {qa.answer?.confidence !== undefined && (
                <span data-testid="answer-confidence">
                  {` \u00b7 confidence ${qa.answer.confidence.toFixed(2)}`}
                </span>
              )}
            </span>
          </span>
        )}
      </div>
      {answeredKey !== null && ranked && (
        <div className="border-b border-border px-rail py-siblings">
          {Object.keys(legend).length > 0 && (
            <div className="text-body">
              <SectionHeading>criteria</SectionHeading>
            </div>
          )}
          {/* one row per option: its bar beside its label, the description beneath; bar length is
              the option's probability, the verdict's options emphasized */}
          <ul
            data-testid="answer-distribution"
            aria-label="answer distribution"
            // a dashed rule between options: lighter than the solid borders between sections
            className="mt-siblings divide-y divide-dashed divide-border"
          >
            {options.map((k) => {
              const prob = probabilities[k] ?? 0;
              const answered = emphasized(k);
              const tier = tierRead?.tierOf(k);
              // the winning tier's bars carry its color; an undecided read colors every bar by its
              // tier, since the split between tiers is the reading
              const tierColor =
                tier !== undefined &&
                (tierRead?.verdict === tier || tierRead?.verdict === "undecided")
                  ? TIER[tier]
                  : null;
              const bar = (
                <span
                  data-testid="option-bar"
                  className="flex h-2 w-16 shrink-0 overflow-hidden rounded-xs bg-border"
                  aria-hidden="true"
                  title={tier !== undefined ? tierRead?.sum(tier) : undefined}
                >
                  <span
                    className={`h-full rounded-xs ${
                      tierRead !== null
                        ? (tierColor ?? "bg-foreground/30")
                        : answered
                          ? "bg-foreground/70"
                          : "bg-foreground/30"
                    }`}
                    style={{ width: `${Math.max(prob * 100, prob > 0 ? 8 : 0)}%` }}
                  />
                </span>
              );
              return (
                <li
                  key={k}
                  data-option={k}
                  data-probability={prob}
                  data-tier={tier}
                  // siblings on each side of a divider; the list's own edges stay the section's
                  className="py-siblings first:pt-0 last:pb-0"
                >
                  <LabeledText label={k} dimmed={!answered} marker={bar}>
                    {legend[k]}
                  </LabeledText>
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {qa.question.instructions && (
        <div className="border-b border-border px-rail py-siblings">
          <LabeledText label="instruction" heading>
            {qa.question.instructions}
          </LabeledText>
        </div>
      )}
      {refused && !isNoulQuestion && (
        <div className="border-b border-border px-rail py-siblings">
          <SectionHeading>criteria</SectionHeading>
          <ul data-testid="refused-criteria" className="mt-siblings flex flex-col gap-siblings">
            {Object.entries(qa.question.criteria ?? {}).map(([k, text]) => (
              <li key={k}>
                <LabeledText label={k}>{text}</LabeledText>
              </li>
            ))}
          </ul>
        </div>
      )}
      {!ranked && (!refused || isNoulQuestion) && (
        <div className="grid grid-cols-2 border-b border-border text-body">
          <div className="bg-background px-rail py-siblings">
            <span className="text-caption text-sev-clean">true</span>
            <p className="mt-related whitespace-pre-wrap break-words text-foreground">
              {qa.question.criteria?.true ?? "—"}
            </p>
          </div>
          <div className="border-l border-dashed border-border bg-background px-rail py-siblings">
            <span className="text-caption text-sev-error">false</span>
            <p className="mt-related whitespace-pre-wrap break-words text-foreground">
              {qa.question.criteria?.false ?? "—"}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
