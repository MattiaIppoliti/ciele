import { EmptyState } from "@/components/ui/empty-state";
import { CreditCard } from "lucide-react";
import type { BillingAccountSnapshot } from "@agent-hub/agent";
import { Card, CardContent, CardHeader, CardTitle } from "@agent-hub/ui";
import { BillingInvoicesTable } from "./billing-invoices-table";
import { openBillingPortalAction } from "@/app/(admin)/settings/billing/actions";
import { PendingSubmitButton } from "@/components/settings/pending-submit-button";
import {
  formatBillingDate,
  formatBillingMoney,
  invoiceRows,
} from "@/lib/billing-account-view";

/**
 * What Stripe knows, on the Billing tab: when the next invoice falls due and for
 * how much, the card it will hit, and the invoices already issued.
 *
 * Every change to any of it: card, tier, cancellation, is a Customer Portal
 * action, so this card reads and links out rather than offering forms Stripe
 * would have to be told about twice.
 */
export function BillingAccountCard({
  account,
}: {
  account: BillingAccountSnapshot;
}) {
  return (
    <>
      <Card className="mt-4">
        <CardHeader>
          <CardTitle>Next invoice</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 text-sm @xl/settings:grid-cols-3">
          <Field label="Renews">{formatBillingDate(account.renewsAt)}</Field>
          <Field label="Projected total">
            {formatBillingMoney(account.nextAmountMinor, account.currency)}
          </Field>
          <Field label="Cancels">{formatBillingDate(account.cancelAt)}</Field>
        </CardContent>
      </Card>

      <Card className="mt-4">
        <CardHeader className="flex-row items-center justify-between gap-4">
          <CardTitle>Payment method</CardTitle>
          {/* The portal is where a card is replaced; we never see one. */}
          <form action={openBillingPortalAction}>
            <PendingSubmitButton
              variant="outline"
              size="sm"
              pendingLabel="Opening Stripe…"
            >
              Update in Stripe
            </PendingSubmitButton>
          </form>
        </CardHeader>
        <CardContent className="text-sm">
          {account.paymentMethod ? (
            <p className="flex items-center gap-2">
              <CreditCard className="text-muted-foreground size-4 shrink-0" />
              <span className="font-medium capitalize">
                {account.paymentMethod.brand.replace(/_/g, " ")}
              </span>
              {account.paymentMethod.last4 && (
                <span className="text-muted-foreground">
                  •••• {account.paymentMethod.last4}
                </span>
              )}
              {account.paymentMethod.expMonth && account.paymentMethod.expYear && (
                <span className="text-muted-foreground">
                  · expires{" "}
                  {String(account.paymentMethod.expMonth).padStart(2, "0")}/
                  {account.paymentMethod.expYear}
                </span>
              )}
            </p>
          ) : (
            <p className="text-muted-foreground">
              No payment method on file, Stripe will ask for one on the next
              invoice.
            </p>
          )}
        </CardContent>
      </Card>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle>Invoices</CardTitle>
        </CardHeader>
        <CardContent>
          {account.invoices.length === 0 ? (
            <EmptyState size="sm" title="No invoices yet"  />
          ) : (
            <BillingInvoicesTable rows={invoiceRows(account.invoices)} />
          )}
        </CardContent>
      </Card>
    </>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className="text-muted-foreground text-xs">{label}</p>
      <p className="mt-0.5 font-medium">{children}</p>
    </div>
  );
}

/* Date, money and status formatting live in `@/lib/billing-account-view`, a
   plain module, so the rules a billing table is read through have tests. */
