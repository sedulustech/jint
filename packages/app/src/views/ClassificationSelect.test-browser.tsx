import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { page } from "vitest/browser";
import { ClassificationSelect } from "./ClassificationSelect";

afterEach(cleanup);

const rows = [0, 1, 2].map((position) => ({
  position,
  label: position === 0 ? "original" : `#${position}`,
  indicator: null,
  value: <span>{position}</span>,
  by: position === 0 ? undefined : ("agent" as const),
}));

test("the select reads 'N of M', steps with arrows and jumps from the list", async () => {
  const onPick = vi.fn();
  render(<ClassificationSelect rows={rows} position={1} onPick={onPick} />);
  const select = () =>
    document.querySelector<HTMLElement>('[data-testid="classification-select"]')!;
  expect(select().textContent).toContain("2 of 3");
  await page.getByTestId("classification-next").click();
  expect(onPick).toHaveBeenLastCalledWith(2);
  await page.getByTestId("classification-prev").click();
  expect(onPick).toHaveBeenLastCalledWith(0);
  await page.getByTestId("classification-select").click();
  await waitFor(() => {
    if (document.querySelector('[data-testid="classification-option"][data-position="2"]') === null)
      throw new Error("list not open");
  });
  const option = document.querySelector<HTMLElement>(
    '[data-testid="classification-option"][data-position="2"]',
  )!;
  expect(option.textContent).toContain("#2");
  option.click();
  expect(onPick).toHaveBeenLastCalledWith(2);
});

test("the arrows wrap around at either end", async () => {
  const onPick = vi.fn();
  render(<ClassificationSelect rows={rows} position={0} onPick={onPick} />);
  await page.getByTestId("classification-prev").click();
  expect(onPick).toHaveBeenLastCalledWith(2);
  cleanup();
  render(<ClassificationSelect rows={rows} position={2} onPick={onPick} />);
  await page.getByTestId("classification-next").click();
  expect(onPick).toHaveBeenLastCalledWith(0);
});
