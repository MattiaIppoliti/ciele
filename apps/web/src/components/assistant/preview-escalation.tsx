"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowRight, X } from "lucide-react";
import { ChevronLeft, LoaderCircle } from "lucide-react";
import { AnimatedIcon } from "@/components/ui/animated-icon";
import { RollInText } from "@/components/motion/roll-in-text";
import { listEscalationDesksAction } from "@/app/actions";
import type { EscalationChannel } from "@/lib/escalation-desks";
import {
  escalationBack,
  escalationConfirmed,
  escalationLoaded,
  escalationOpenChannel,
  escalationOpenDesk,
  escalationScreen,
  loadingEscalationNav,
  type EscalationNav,
} from "@/lib/escalation-navigation";
import { channelAvailabilityNow } from "@/lib/channel-availability";
import {
  EscalationFieldInput,
  initialFormValues,
} from "@/components/widget/widget-escalation";

/**
 * A channel target is admin-typed (an External link's URL), so only the
 * schemes a contact row can mean become an href; anything else, a
 * `javascript:` URL included, renders as an info-only row.
 */
const SAFE_TARGET = /^(https?:|mailto:|tel:)/i;

/**
 * The Preview twin of the widget's escalation screen ("How would you like to
 * contact …?"): the assistant's selected help desks → a desk's channels →
 * an email channel's configured form. Opened by the floating contact-support
 * button, an escalation quick reply, or an AI-recommended help_desk part.
 * Reads the live Help Desks settings (server action), not a Publication
 * snapshot. Submitting a form here only previews the confirmation message,
 * no escalation email leaves the Preview.
 */
export function PreviewEscalation({
  assistantId,
  initialHelpDeskId,
  onBack,
}: {
  assistantId: string;
  initialHelpDeskId?: string;
  onBack: () => void;
}) {
  const [nav, setNav] = useState<EscalationNav<string>>(loadingEscalationNav);
  const { desks, activeDesk, activeChannel, confirmation } = nav;
  const [values, setValues] = useState<Record<string, string>>({});
  // A failed read is its own screen with a retry, not the "no channels yet"
  // empty state, which would tell the admin to configure what already exists.
  const [loadFailed, setLoadFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const screenRoot = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    listEscalationDesksAction(assistantId)
      .then((loaded) => {
        if (cancelled) return;
        setNav((current) => escalationLoaded(current, loaded, initialHelpDeskId));
      })
      .catch(() => {
        if (!cancelled) setLoadFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [assistantId, initialHelpDeskId, attempt]);

  const screen = loadFailed ? "error" : escalationScreen(nav);

  // Each screen replaces the one the pressed control lived on, so focus would
  // otherwise fall back to the document. Land it on the new screen's heading
  // (or the confirmation) instead.
  useEffect(() => {
    if (screen === "loading") return;
    screenRoot.current?.querySelector<HTMLElement>("[data-screen-focus]")?.focus();
  }, [screen, activeDesk, activeChannel]);

  function retry() {
    setLoadFailed(false);
    setAttempt((n) => n + 1);
  }

  function back() {
    const popped = escalationBack(nav);
    if (popped) setNav(popped);
    else onBack();
  }

  function openForm(channel: EscalationChannel) {
    setValues(initialFormValues(channel.form?.fields ?? []));
    setNav((current) => escalationOpenChannel(current, channel));
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between px-4 py-4">
        <button
          type="button"
          onClick={back}
          className="hover:bg-muted flex items-center gap-2 rounded-xl border px-4 py-2 text-sm font-semibold"
        >
          <ChevronLeft className="size-4" strokeWidth={3} /> Back
        </button>
        <button
          type="button"
          aria-label="Close support"
          onClick={onBack}
          className="hover:bg-muted rounded p-1.5"
        >
          <AnimatedIcon icon={X} size={20} />
        </button>
      </div>
      <div ref={screenRoot} className="no-scrollbar flex-1 overflow-y-auto px-5 pb-6">
        {screen === "loading" && (
          <p className="text-muted-foreground flex items-center gap-2 pt-6 text-sm">
            <LoaderCircle className="size-4 animate-spin" /> Loading support
            options…
          </p>
        )}
        {screen === "error" && (
          <div className="pt-6 text-sm">
            <p data-screen-focus tabIndex={-1} className="outline-none">
              Support options could not load.
            </p>
            <button
              type="button"
              onClick={retry}
              className="press-control hover:bg-muted mt-3 rounded-xl border px-4 py-2 font-semibold"
            >
              Try again
            </button>
          </div>
        )}
        {screen === "empty" && (
          <p className="text-muted-foreground pt-6 text-sm">
            No support channels yet. Select help desks below and add channels to them.
          </p>
        )}

        {/* Confirmation after a (simulated) form submission */}
        {screen === "confirmation" && confirmation && (
          <p
            role="status"
            data-screen-focus
            tabIndex={-1}
            className="pt-6 text-[0.9375rem] leading-relaxed outline-none"
          >
            {confirmation}
          </p>
        )}

        {/* Channel form ("Helpdesk form") */}
        {screen === "form" && activeChannel?.form && (
          <>
            <h2
              data-screen-focus
              tabIndex={-1}
              className="text-2xl leading-snug font-semibold break-words outline-none"
            >
              {activeChannel.form.title}
            </h2>
            <form
              className="mt-5 space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                setNav((current) =>
                  escalationConfirmed(
                    current,
                    activeChannel.form!.confirmationMessage.trim() ||
                      "Thanks! Your request has been sent, our team will get back to you."
                  )
                );
              }}
            >
              {activeChannel.form.fields.map((field) => (
                // The shared input takes no id, so the label wraps it: an
                // enclosing <label> names its control without htmlFor.
                <label key={field.id} className="block">
                  <span className="block text-sm font-semibold">
                    {field.label}
                    {field.required && (
                      <span className="text-destructive"> *</span>
                    )}
                  </span>
                  <span className="mt-1.5 block">
                    <EscalationFieldInput
                      field={field}
                      value={values[field.id] ?? ""}
                      onChange={(value) =>
                        setValues((prev) => ({ ...prev, [field.id]: value }))
                      }
                      className="bg-background focus:ring-ring/50 w-full rounded-xl border px-3.5 py-2.5 text-sm outline-none focus:ring-2"
                    />
                  </span>
                </label>
              ))}
              <button
                type="submit"
                className="bg-muted hover:bg-muted/80 w-full rounded-xl px-4 py-3 text-sm font-semibold transition-colors"
              >
                Submit
              </button>
            </form>
          </>
        )}

        {/* Desk list */}
        {screen === "desks" && desks && (
          <>
            <h2
              data-screen-focus
              tabIndex={-1}
              className="text-2xl leading-snug font-semibold outline-none"
            >
              How would you like to contact us?
            </h2>
            <div className="mt-5 space-y-3">
              {desks.map((desk) => (
                <button
                  key={desk.id}
                  type="button"
                  onClick={() => setNav((current) => escalationOpenDesk(current, desk))}
                  className="bg-muted/50 hover:bg-muted flex w-full items-center justify-between gap-3 rounded-2xl px-5 py-4 text-left transition-colors"
                >
                  <span className="min-w-0 text-base font-semibold break-words">
                    {desk.name}
                  </span>
                  <span className="bg-card flex size-10 shrink-0 items-center justify-center rounded-xl border">
                    <AnimatedIcon icon={ArrowRight} size={16} />
                  </span>
                </button>
              ))}
            </div>
          </>
        )}

        {/* Channel list for the chosen desk */}
        {screen === "channels" && activeDesk && (
          <>
            <h2
              data-screen-focus
              tabIndex={-1}
              className="text-2xl leading-snug font-semibold break-words outline-none"
            >
              How would you like to contact {activeDesk.name}?
            </h2>
            <div className="mt-5 space-y-3">
              {activeDesk.channels.map((channel) => {
                const availability = channelAvailabilityNow(
                  channel.availability
                );
                const href =
                  channel.target && SAFE_TARGET.test(channel.target)
                    ? channel.target
                    : null;
                const actionable = href !== null || channel.form !== null;
                const arrow = (
                  <span
                    className={`bg-card flex size-10 shrink-0 items-center justify-center rounded-xl border ${
                      actionable ? "" : "opacity-40"
                    }`}
                  >
                    <AnimatedIcon icon={ArrowRight} size={16} />
                  </span>
                );
                const body = (
                  <>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                        <span className="min-w-0 text-lg font-semibold break-words">
                          {channel.name}
                        </span>
                        <span className="bg-card ring-border inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1">
                          <span
                            className={`size-1.5 rounded-full ${
                              availability.available
                                ? "bg-emerald-500"
                                : "bg-muted-foreground/60"
                            }`}
                          />
                          <RollInText
                            text={
                              availability.available ? "Available" : "Unavailable"
                            }
                          />
                        </span>
                      </div>
                      {!availability.available && availability.nextWindow && (
                        <p className="text-muted-foreground mt-1.5 text-sm">
                          Next available: {availability.nextWindow}
                        </p>
                      )}
                    </div>
                    {arrow}
                  </>
                );
                const rowClass =
                  "bg-muted/50 flex w-full items-center justify-between gap-3 rounded-2xl px-5 py-4 text-left";
                if (channel.form) {
                  return (
                    <button
                      key={channel.id}
                      type="button"
                      onClick={() => openForm(channel)}
                      className={`${rowClass} hover:bg-muted transition-colors`}
                    >
                      {body}
                    </button>
                  );
                }
                if (href) {
                  const external = /^https?:/i.test(href);
                  return (
                    <a
                      key={channel.id}
                      href={href}
                      {...(external
                        ? { target: "_blank", rel: "noopener noreferrer" }
                        : {})}
                      className={`${rowClass} hover:bg-muted transition-colors`}
                    >
                      {body}
                    </a>
                  );
                }
                return (
                  <div key={channel.id} className={rowClass}>
                    {body}
                  </div>
                );
              })}
              {activeDesk.channels.length === 0 && (
                <p className="text-muted-foreground text-sm">
                  This help desk has no enabled channels yet.
                </p>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
