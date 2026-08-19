import { CreditCard, ExternalLink } from "lucide-react";
import type { BillingAccountSnapshot } from "@agent-hub/agent";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle } from "@agent-hub/ui";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { openBillingPortalAction } from "@/app/(admin)/settings/billing/actions";
import {
  EMPTY_FIELD,
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
        <CardContent className="grid gap-4 text-sm sm:grid-cols-3">
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
            <Button type="submit" variant="outline" size="sm">
              Update in Stripe
            </Button>
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
            <p className="text-muted-foreground py-2 text-sm">
              No invoices issued yet.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  {/* The provider's invoice number: what an accounts department
                      reconciles a payment against. */}
                  <TableHead>Number</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="text-right">Invoice</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invoiceRows(account.invoices).map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-medium">{row.dateLabel}</TableCell>
                    <TableCell className="text-muted-foreground tabular-nums">
                      {row.numberLabel}
                    </TableCell>
                    <TableCell>
                      <Badge variant={row.statusVariant}>{row.statusLabel}</Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.amountLabel}
                    </TableCell>
                    <TableCell className="text-right">
                      {row.url ? (
                        <a
                          href={row.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 underline underline-offset-4"
                        >
                          View <ExternalLink className="size-3" />
                        </a>
                      ) : (
                        EMPTY_FIELD
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
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
