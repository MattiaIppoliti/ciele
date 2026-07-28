/**
 * How the Billing tab reads a provider account: dates, money, invoice status.
 *
 * These were three helpers inside `billing-account-card.tsx`. They live here for
 * two reasons:
 *
 *  1. **They are testable.** vitest only picks up `.test.ts` in this app, so
 *     anything worth pinning has to sit in a plain module — and money formatting
 *     on a page about charges is worth pinning.
 *  2. **They must not drift between server and client.** The card is server-
 *     rendered; `Intl` output depends on the runtime's locale data, so both the
 *     locale and the time zone are fixed here rather than left to the ambient
 *     environment (the same reason `format.ts` exists).
 */

import type { BillingInvoice } from "@agent-hub/agent";

/** Fixed so two admins in different time zones read the same date. */
const DATE_LOCALE = "en-GB";
const DATE_ZONE = "UTC";

/** What an empty value prints as, everywhere on the tab. */
export const EMPTY_FIELD = "—";

/** "28 Jul 2026", or the em dash when there is no date. */
export function formatBillingDate(iso: string | null): string {
  if (!iso) return EMPTY_FIELD;
  const date = new Date(iso);
  // An unparseable instant is a provider or storage bug; printing "Invalid Date"
  // in a billing table would be worse than admitting we have nothing.
  if (Number.isNaN(date.getTime())) return EMPTY_FIELD;
  return date.toLocaleDateString(DATE_LOCALE, {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: DATE_ZONE,
  });
}

/**
 * Minor units in the currency the provider billed in. Never re-denominated: an
 * invoice in USD prints as USD, because that is what the customer was charged.
 */
export function formatBillingMoney(
  amountMinor: number | null,
  currency: string,
): string {
  if (amountMinor === null || !Number.isFinite(amountMinor)) return EMPTY_FIELD;
  return (amountMinor / 100).toLocaleString(DATE_LOCALE, {
    style: "currency",
    currency: currency.toUpperCase(),
  });
}

/** Badge variants the card can render. Mirrors the `Badge` primitive's props. */
export type InvoiceBadgeVariant = "secondary" | "outline" | "destructive";

/**
 * Status → wording + badge. `paid` is the only settled outcome; `open` is still
 * payable and `uncollectible` has been given up on — different facts to a
 * customer reading their own history, so they must not share one neutral badge.
 * An unknown status prints verbatim rather than being flattened into a guess.
 */
export function invoiceStatusView(status: string): {
  label: string;
  variant: InvoiceBadgeVariant;
} {
  switch (status) {
    case "paid":
      return { label: "Paid", variant: "secondary" };
    case "open":
      return { label: "Open", variant: "outline" };
    case "uncollectible":
      return { label: "Uncollectible", variant: "destructive" };
    case "void":
      return { label: "Void", variant: "outline" };
    default:
      return {
        label: status.charAt(0).toUpperCase() + status.slice(1),
        variant: "outline",
      };
  }
}

/** One invoice row, fully formatted — the component only lays it out. */
export interface InvoiceRow {
  id: string;
  dateLabel: string;
  /** The provider's invoice number, or the em dash before one is assigned. */
  numberLabel: string;
  amountLabel: string;
  statusLabel: string;
  statusVariant: InvoiceBadgeVariant;
  /** Provider-hosted invoice page, when there is one to link. */
  url: string | null;
}

/** The rows for the invoice table, in the order the provider returned them. */
export function invoiceRows(invoices: BillingInvoice[]): InvoiceRow[] {
  return invoices.map((invoice) => {
    const status = invoiceStatusView(invoice.status);
    return {
      id: invoice.id,
      dateLabel: formatBillingDate(invoice.issuedAt),
      numberLabel: invoice.number ?? EMPTY_FIELD,
      amountLabel: formatBillingMoney(invoice.amountMinor, invoice.currency),
      statusLabel: status.label,
      statusVariant: status.variant,
      url: invoice.url,
    };
  });
}
