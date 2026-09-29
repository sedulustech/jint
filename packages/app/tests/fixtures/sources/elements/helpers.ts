export type Invoice = { id: string; lines: InvoiceLine[] };
export type InvoiceLine = { unitPrice: number; quantity: number; label: string };

export function mergeInvoices(a: Invoice, b: Invoice): Invoice {
  return { id: `${a.id}+${b.id}`, lines: [...a.lines, ...b.lines] };
}
