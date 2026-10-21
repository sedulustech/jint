import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import { AnswerCard, type QA } from "./AnswerCard";

afterEach(cleanup);

// A choice answer: the selected option is the answer, one bar per option keyed by label, and the
// options' meanings come from the question (a choice answer carries no legend).
const choiceQA: QA = {
  key: "is_comment_justified",
  rule: "is_comment_justified",
  question: {
    type: "choice",
    instructions: "Which option fits?",
    criteria: {
      justified: "states what the code does",
      contradicted: "claims what the code does not",
    },
  },
  answer: {
    type: "choice",
    choice: "contradicted",
    confidence: 0.6,
    probabilities: { justified: 0.3, contradicted: 0.7 },
  },
};

test("a choice answer renders the selected option and one bar per option", () => {
  const { container } = render(<AnswerCard qa={choiceQA} sev="error" />);
  expect(container.querySelector("[data-answer]")?.getAttribute("data-answer")).toBe(
    "contradicted",
  );
  const bars = [...container.querySelectorAll('[data-testid="answer-distribution"] > li')];
  expect(bars.map((b) => b.getAttribute("data-option"))).toEqual(["justified", "contradicted"]);
  expect(Number(bars[1]!.getAttribute("data-probability"))).toBeCloseTo(0.7);
  // the selected option's bar is the emphasized one
  const selected = container.querySelector(
    '[data-testid="answer-distribution"] li[data-option="contradicted"] span span',
  );
  expect(selected?.className).toContain("bg-foreground/70");
  // the true/false criteria grid is noul-only
  expect(container.textContent).not.toContain("true");
});
