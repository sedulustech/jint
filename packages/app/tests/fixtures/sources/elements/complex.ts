// A deliberately mixed file: nested functions, a class, varied naming — the walker has real
// structure to descend into and the classifier has real per-element states to judge.

export function computeInvoiceTotal(lines: InvoiceLine[], taxRate: number): number {
  const subtotal = lines.reduce((acc, line) => acc + line.unitPrice * line.quantity, 0);
  function roundToCents(value: number): number {
    return Math.round(value * 100) / 100;
  }
  return roundToCents(subtotal * (1 + taxRate));
}

export class InvoicePrinter {
  private width = 42;

  render(invoice: Invoice): string {
    const fmt = (n: number): string => n.toFixed(2).padStart(this.width);
    const header = "INVOICE".padEnd(this.width);
    const body = invoice.lines.map((l) => fmt(l.unitPrice * l.quantity)).join("\n");
    return [header, body].join("\n");
  }
}

// datax keeps a data element in the inventory: the const below is not a definition everywhere.
export const DEFAULT_TAX_RATE = 0.19;
