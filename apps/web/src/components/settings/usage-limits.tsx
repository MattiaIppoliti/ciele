import { RadialGauge, type RadialGaugeRing } from "@agent-hub/charts";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@agent-hub/ui";
import { Link } from "@/components/ui/link";
import { cn } from "@/lib/utils";
import {
  TONE_STROKE,
  TONE_TEXT,
  type MeterCardView,
  type MeterRingView,
  type MeterTone,
  type UsageLimitsView,
} from "@/lib/usage-meters";

/**
 * "Your usage limits", the plan's meters as rings (#509).
 *
 * A thin renderer: every number, threshold and label comes from
 * `usage-meters.ts`, which is where the tests are. One card per metered
 * resource, one ring per window (week outside, billing period inside), and the
 * percentage of whichever window is closest to its cap in the middle.
 */

const ringsOf = (rings: readonly MeterRingView[]): RadialGaugeRing[] =>
  rings.map((ring) => ({
    fraction: ring.fraction,
    toneClass: TONE_STROKE[ring.tone],
    label: `${ring.label}: ${ring.percentLabel} used`,
  }));

function Gauge({
  rings,
  lead,
  tone,
}: {
  rings: RadialGaugeRing[];
  lead: string;
  tone: MeterTone;
}) {
  return (
    <RadialGauge size={88} strokeWidth={7} gap={3} rings={rings}>
      <span
        className={cn("text-lg font-semibold tabular-nums", TONE_TEXT[tone])}
      >
        {lead}
      </span>
    </RadialGauge>
  );
}

function RingLines({ rings }: { rings: MeterRingView[] }) {
  return (
    <div className="space-y-2 text-sm">
      {rings.map((ring) => (
        <div key={ring.label}>
          <p>
            <span className="text-muted-foreground">{ring.label}:</span>{" "}
            <span
              className={cn("font-medium tabular-nums", TONE_TEXT[ring.tone])}
            >
              {ring.usedLabel}
            </span>
            <span className="text-muted-foreground"> / {ring.capLabel}</span>
          </p>
          <p className="text-muted-foreground text-xs">{ring.resetLabel}</p>
        </div>
      ))}
    </div>
  );
}

function MeterCard({ card }: { card: MeterCardView }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{card.title}</CardTitle>
        <CardDescription>{card.description}</CardDescription>
      </CardHeader>
      <CardContent className="flex items-center gap-4">
        {card.rings.length > 0 ? (
          <>
            <Gauge
              rings={ringsOf(card.rings)}
              lead={card.leadPercent}
              tone={card.tone}
            />
            <RingLines rings={card.rings} />
          </>
        ) : (
          <p className="text-muted-foreground text-sm">
            No limit recorded for this meter yet.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * The organization's own daily ceiling, drawn like a plan meter. Rendered
 * whether or not there is a plan: on a self-hosted deployment it is the ONLY
 * limit that can pause an assistant, which is exactly when it matters most.
 */
export function DailyBudgetCard({
  budget,
}: {
  budget: { rings: MeterRingView[]; tone: MeterTone };
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Daily budget</CardTitle>
        <CardDescription>
          Your own ceiling, set in AI settings, independent of any plan
        </CardDescription>
      </CardHeader>
      <CardContent className="flex items-center gap-4">
        <Gauge
          rings={ringsOf(budget.rings)}
          lead={budget.rings[0].percentLabel}
          tone={budget.tone}
        />
        <RingLines rings={budget.rings} />
      </CardContent>
    </Card>
  );
}

export function UsageLimitsBlock({
  view,
  budget,
  ownCredentialsOnly,
}: {
  view: UsageLimitsView;
  /** The admin-set daily budget, when one is configured. */
  budget: { rings: MeterRingView[]; tone: MeterTone } | null;
  /** True when the recorded window's work all ran on the customer's own keys. */
  ownCredentialsOnly: boolean;
}) {
  return (
    <section className="mt-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold tracking-tight">
          Your usage limits
        </h2>
        <p className="text-muted-foreground text-sm">
          Plan:{" "}
          <Link
            href="/settings/billing"
            className="text-foreground font-medium underline underline-offset-4"
          >
            {view.plan}
          </Link>
        </p>
      </div>
      <p className="text-muted-foreground mt-1 text-sm">
        Each meter is capped for the billing period and, more tightly, for each
        week of it, so a busy few days cannot spend the whole period. Only
        platform-funded work counts.
      </p>

      {ownCredentialsOnly ? (
        <p className="text-muted-foreground mt-3 text-sm">
          Everything recorded in the last 30 days ran on your own credentials,
          so none of it counts against these limits.
        </p>
      ) : null}

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        {view.cards.map((card) => (
          <MeterCard key={card.resource} card={card} />
        ))}
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Credits this period</CardTitle>
            <CardDescription>
              {view.total.partial
                ? "The capped meters together, against what the plan includes"
                : "All three meters together, against what the plan includes"}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex items-center gap-4">
            {/* No tone: nothing caps the SUM of the three meters, so colouring
                this amber would warn about a limit that cannot be reached. */}
            <Gauge
              rings={[
                {
                  fraction: view.total.fraction,
                  toneClass: TONE_STROKE.ok,
                  label: `This billing period: ${view.total.percentLabel} used`,
                },
              ]}
              lead={view.total.percentLabel}
              tone="ok"
            />
            <div className="text-sm">
              <p>
                <span className="font-medium tabular-nums">
                  {view.total.usedLabel}
                </span>
                <span className="text-muted-foreground">
                  {" "}
                  / {view.total.capLabel} credits
                </span>
              </p>
              {view.total.partial ? (
                <p className="text-muted-foreground text-xs">
                  A meter with no limit is left out of this total.
                </p>
              ) : null}
            </div>
          </CardContent>
        </Card>

        {budget ? <DailyBudgetCard budget={budget} /> : null}
      </div>
    </section>
  );
}

/**
 * What a deployment with no caps sees instead of gauges. Two cases, because they
 * are different facts: no managed plan at all (self-hosted, the open-source
 * edition), or a plan whose meters are all uncapped, a staff exemption, or
 * billing data too stale to enforce against. Zeroed rings under "each meter is
 * capped" copy would be a lie, so this says it in words.
 */
export function UnmeteredNotice({ plan }: { plan?: string }) {
  return (
    <Card className="mt-6">
      <CardHeader>
        <CardTitle>No usage limits</CardTitle>
        <CardDescription>
          {plan
            ? `The ${plan} plan is running without caps on this organization`
            : "This deployment is unmetered, nothing here is capped"}
        </CardDescription>
      </CardHeader>
      <CardContent className="text-muted-foreground space-y-2 text-sm">
        {plan ? (
          <p>
            Every meter is currently uncapped, so assistants answer, index and
            crawl without a ceiling. That is either a deliberate exemption on
            your organization or a temporary state while billing details catch
            up, your billing page has the plan itself.
          </p>
        ) : (
          <p>
            Usage limits apply to organizations on a managed plan, where the
            platform funds the model credentials. This deployment has no plan,
            so assistants answer, index and crawl without a ceiling.
          </p>
        )}
        <p>
          The figures below are still recorded, so you can see what the work
          would cost.
        </p>
      </CardContent>
    </Card>
  );
}
