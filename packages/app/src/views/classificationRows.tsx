import { asTier, type ChoiceHandlerData, type HandlerLevel } from "@jint/contract";
import { TIER, TIER_TEXT } from "./color";
import type { QA } from "./AnswerCard";
import type { ClassificationRow } from "./ClassificationSelect";

type Answer = QA["answer"];
type Gate = { greater_than?: number; less_than?: number };
export type Gates = { warn?: Gate; error?: Gate };

/** What a rule's handle says about its readings, by question kind. */
export interface RowHandle {
  /** A noul rule's thresholds. */
  gates?: Gates;
  /** A score rule's tier for each level, in level order. */
  scoreTiers?: HandlerLevel[];
  /** A choice rule's option tiers, and its options in the question's own order. */
  choices?: ChoiceHandlerData;
  options?: string[];
}

/** The tier a noul value falls in, read against the rule's own thresholds. */
function noulTier(value: number, gates: Gates | undefined): HandlerLevel {
  const over = (g: Gate | undefined) =>
    g !== undefined &&
    ((g.greater_than !== undefined && value > g.greater_than) ||
      (g.less_than !== undefined && value < g.less_than));
  if (over(gates?.error)) return "error";
  if (over(gates?.warn)) return "warn";
  return "pass";
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

function rowFor(
  answer: Answer,
  handle: RowHandle,
): Pick<ClassificationRow, "indicator" | "value"> | null {
  if (typeof answer?.noul === "number") {
    const tier = noulTier(answer.noul, handle.gates);
    return {
      indicator: (
        <span className="relative h-1 w-12 rounded-full bg-border">
          <span
            className={`absolute inset-y-0 left-0 rounded-full ${TIER[tier]}`}
            style={{ width: `${clamp(answer.noul, 0, 1) * 100}%` }}
          />
        </span>
      ),
      value: <span className={TIER_TEXT[tier]}>{answer.noul.toFixed(2)}</span>,
    };
  }
  if (typeof answer?.score === "number" && handle.scoreTiers !== undefined) {
    const tiers = handle.scoreTiers;
    const level = clamp(Math.round(answer.score), 0, tiers.length - 1);
    return {
      indicator: (
        <span className="flex w-12 gap-px">
          {tiers.map((tier, k) => (
            <span
              key={k}
              className={`h-1.5 flex-1 rounded-xs ${k === level ? TIER[tier] : "bg-border"}`}
            />
          ))}
        </span>
      ),
      value: (
        <span className={TIER_TEXT[tiers[level]!]}>
          {level} · {answer.score.toFixed(2)}
        </span>
      ),
    };
  }
  if (answer?.choice !== undefined && handle.choices !== undefined) {
    const { choices } = handle;
    const tierOf = (option: string) =>
      choices.choices[option] === undefined ? undefined : asTier(choices.choices[option]).level;
    const probabilities = answer.probabilities ?? { [answer.choice]: 1 };
    const tier = tierOf(answer.choice);
    return {
      indicator: (
        <span className="flex h-1.5 w-12 overflow-hidden rounded-xs">
          {(handle.options ?? []).map((option) => {
            const t = tierOf(option);
            return (
              <span
                key={option}
                className={t === undefined ? "bg-foreground/30" : TIER[t]}
                style={{ width: `${(probabilities[option] ?? 0) * 100}%` }}
              />
            );
          })}
        </span>
      ),
      value: <span className={tier === undefined ? "" : TIER_TEXT[tier]}>{answer.choice}</span>,
    };
  }
  return null;
}

/** One row per classification of one address: the original first, then every filed one. */
export function classificationRows(
  answers: Answer[],
  filedBy: ("rule" | "agent" | "user" | undefined)[],
  handle: RowHandle,
): ClassificationRow[] {
  return answers.map((answer, position) => {
    const read = rowFor(answer, handle);
    return {
      position,
      label: position === 0 ? "original" : `#${position}`,
      indicator: read?.indicator ?? null,
      value: read?.value ?? <span className="text-muted-foreground">no reading</span>,
      by: filedBy[position],
    };
  });
}
