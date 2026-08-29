import { describe, expect, it } from "vitest";
import type { BillingInvoice } from "@agent-hub/agent";
import {
  EMPTY_FIELD,
  formatBillingDate,
  formatBillingMoney,
  invoiceRows,
  invoiceStatusView,
} from "./billing-account-view";

const invoice = (over: Partial<BillingInvoice> = {}): BillingInvoice => ({
  id: "in_1",
  number: "N3WRKR5S-0001",
  issuedAt: "2026-07-28T14:47:49.000Z",
  amountMinor: 4900,
  currency: "eur",
  status: "paid",
  url: "https://invoice.example/hosted",
  ...over,
});

describe("formatBillingDate", () => {
  it("prints a fixed day/month/year", () => {
    expect(formatBillingDate("2026-07-28T14:47:49.000Z")).toBe("28 Jul 2026");
  });

  it("reads the instant in UTC, not the runtime's zone", () => {
    // 23:30 UTC is already the 29th in CEST; the tab must say the 28th for
    // everyone, or two admins reconcile against different dates.
    expect(formatBillingDate("2026-07-28T23:30:00.000Z")).toBe("28 Jul 2026");
  });

  it("falls back to the em dash rather than printing Invalid Date", () => {
    expect(formatBillingDate(null)).toBe(EMPTY_FIELD);
    expect(formatBillingDate("not-a-date")).toBe(EMPTY_FIELD);
  });
});

describe("formatBillingMoney", () => {
  it("renders minor units in the billed currency", () => {
    expect(formatBillingMoney(4900, "eur")).toBe("€49.00");
    expect(formatBillingMoney(19_900, "eur")).toBe("€199.00");
  });

  it("keeps cents a plan price never has", () => {
    expect(formatBillingMoney(1166, "eur")).toBe("€11.66");
  });

  it("never re-denominates: a dollar invoice prints as dollars", () => {
    expect(formatBillingMoney(4900, "usd")).toBe("US$49.00");
  });

  it("prints a zero total rather than treating it as absent", () => {
    expect(formatBillingMoney(0, "eur")).toBe("€0.00");
  });

  it("falls back to the em dash for an unknown amount", () => {
    expect(formatBillingMoney(null, "eur")).toBe(EMPTY_FIELD);
  });
});

describe("invoiceStatusView", () => {
  it("settles only on paid", () => {
    expect(invoiceStatusView("paid")).toEqual({
      label: "Paid",
      variant: "secondary",
    });
  });

  it("separates still-payable from given-up-on", () => {
    expect(invoiceStatusView("open").variant).toBe("outline");
    expect(invoiceStatusView("uncollectible").variant).toBe("destructive");
  });

  it("prints an unrecognized status verbatim", () => {
    expect(invoiceStatusView("disputed")).toEqual({
      label: "Disputed",
      variant: "outline",
    });
  });
});

describe("invoiceRows", () => {
  it("formats a row for the table", () => {
    expect(invoiceRows([invoice()])).toEqual([
      {
        id: "in_1",
        dateLabel: "28 Jul 2026",
        numberLabel: "N3WRKR5S-0001",
        amountLabel: "€49.00",
        statusLabel: "Paid",
        statusVariant: "secondary",
        url: "https://invoice.example/hosted",
      },
    ]);
  });

  it("shows the em dash for an invoice with no number yet", () => {
    expect(invoiceRows([invoice({ number: null })])[0].numberLabel).toBe(
      EMPTY_FIELD,
    );
  });

  it("preserves the provider's newest-first order", () => {
    const rows = invoiceRows([
      invoice({ id: "in_2", issuedAt: "2026-07-28T00:00:00.000Z" }),
      invoice({ id: "in_1", issuedAt: "2026-06-28T00:00:00.000Z" }),
    ]);
    expect(rows.map((row) => row.dateLabel)).toEqual([
      "28 Jul 2026",
      "28 Jun 2026",
    ]);
  });
});
