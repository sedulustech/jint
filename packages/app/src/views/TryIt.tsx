import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { fetchTries, postTry, type TryRecord } from "../api/client";
import type { QA } from "./AnswerCard";

interface Edit {
  instructions?: string;
  criteria: Record<string, string>;
  code?: string;
}

/**
 * The iterations of one pair. Position 0 is the original; every classify files a try under the run
 * (server side) and becomes the next position, so the iterations cycle. The cards render the draft
 * - the original question and code with the reader's edits laid over them - and moving to an
 * iteration loads its edit and its answer into the draft. The original is never touched: position 0
 * always shows it.
 */
export function useTryIt(
  pair: { runId: string; rule: string; input: string },
  qa: QA | undefined,
  path: string | undefined,
  code: string | null,
  codeKey: string,
) {
  const { runId, rule, input } = pair;
  const queryKey = ["tries", runId, rule, input];
  const client = useQueryClient();
  const tries = useQuery({ queryKey, queryFn: () => fetchTries(runId, rule, input) }).data ?? [];
  const [position, setPosition] = useState(0);
  const [draft, setDraft] = useState<Edit>({ criteria: {} });
  // the reading on show and the edit it answered, so a later edit marks it stale, never hides it
  const [shown, setShown] = useState<{ answer: NonNullable<QA["answer"]>; baseline: string }>();

  const original = qa?.question.criteria ?? {};
  const instructions = draft.instructions ?? qa?.question.instructions ?? "";
  const merged: Record<string, string> = {
    ...Object.fromEntries(Object.entries(original)),
    ...draft.criteria,
  };
  // a score rubric is an array: its index is the level
  const criteria = Array.isArray(original) ? Object.values(merged) : merged;
  const text = draft.code ?? code ?? "";
  // the state as the model saw it: a path only where the recorded request carried one
  const stateFor = (code: string): { path?: string; [codeKey: string]: string | undefined } => ({
    path,
    [codeKey]: code,
  });
  const body = {
    state: stateFor(text),
    question: { type: qa?.question.type ?? "noul", instructions, criteria },
  };
  const editKey = JSON.stringify(body);

  /** Load iteration `at` (0 = the original) into the draft. */
  const go = (at: number, from: TryRecord[] = tries) => {
    const t = at === 0 ? undefined : from[at - 1];
    setPosition(at);
    if (t === undefined) {
      setDraft({ criteria: {} });
      setShown(undefined);
      return;
    }
    const loaded: Edit = {
      instructions: t.question.instructions,
      criteria: Object.fromEntries(Object.entries(t.question.criteria ?? {})),
      code: t.state.content ?? t.state.source,
    };
    setDraft(loaded);
    setShown({
      answer: t.answer,
      baseline: JSON.stringify({
        state: stateFor(loaded.code ?? ""),
        question: {
          type: t.question.type,
          instructions: t.question.instructions,
          criteria: t.question.criteria,
        },
      }),
    });
  };

  const ask = useMutation({
    mutationFn: () => postTry(runId, { rule, input }, body),
    onSuccess: (filed) => {
      const next = [...tries, filed];
      client.setQueryData(queryKey, next);
      setPosition(next.length);
      setShown({ answer: filed.answer, baseline: editKey });
    },
  });

  return {
    ask,
    position,
    total: tries.length + 1,
    /** The answer at each position: the original first, then every try. */
    answers: [qa?.answer, ...tries.map((t) => t.answer)],
    /** Who filed each position: the original has no filer. */
    filedBy: [undefined, ...tries.map((t) => t.by ?? "manual")] as (TryRecord["by"] | undefined)[],
    go,
    reset: () => go(0),
    /** The new reading on show; stale when the edit moved on after it. */
    asked: shown === undefined ? undefined : { stale: shown.baseline !== editKey },
    dirty:
      draft.instructions !== undefined ||
      draft.code !== undefined ||
      Object.keys(draft.criteria).length > 0,
    text,
    setText: (code: string) => setDraft((d) => ({ ...d, code })),
    /** The original pair with the draft applied and, at an iteration, its answer in place. */
    edited:
      qa === undefined
        ? undefined
        : {
            ...qa,
            question: { ...qa.question, instructions, criteria },
            answer: shown?.answer ?? qa.answer,
          },
    edit: {
      instructions: (value: string) => setDraft((d) => ({ ...d, instructions: value })),
      criteria: (key: string, value: string) =>
        setDraft((d) => ({ ...d, criteria: { ...d.criteria, [key]: value } })),
    },
  };
}
