"use client";

import { useEffect, useState } from "react";
import { ArrowRight, ChevronLeft, LoaderCircle, X } from "lucide-react";
import { AnimatedIcon } from "@/components/ui/animated-icon";
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

  useEffect(() => {
    let cancelled = false;
    listEscalationDesksAction(assistantId)
      .then((loaded) => {
        if (cancelled) return;
        setNav((current) => escalationLoaded(current, loaded, initialHelpDeskId));
      })
      .catch(() => {
        if (!cancelled) setNav((current) => escalationLoaded(current, []));
      });
    return () => {
      cancelled = true;
    };
  }, [assistantId, initialHelpDeskId]);

  const screen = escalationScreen(nav);

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
      <div className="no-scrollbar flex-1 overflow-y-auto px-5 pb-6">
        {screen === "loading" && (
          <p className="text-muted-foreground flex items-center gap-2 pt-6 text-sm">
            <LoaderCircle className="size-4 animate-spin" /> Loading support
            options…
          </p>
        )}
        {screen === "empty" && (
          <p className="text-muted-foreground pt-6 text-sm">
            No support channels are available right now. Select help desks
            below and add channels in the Help Desks library.
          </p>
        )}

        {/* Confirmation after a (simulated) form submission */}
        {screen === "confirmation" && confirmation && (
          <p className="pt-6 text-[15px] leading-relaxed">{confirmation}</p>
        )}

        {/* Channel form ("Helpdesk form") */}
        {screen === "form" && activeChannel?.form && (
          <>
            <h2 className="text-2xl leading-snug font-bold">
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
                <div key={field.id}>
                  <label className="block text-sm font-semibold">
                    {field.label}
                    {field.required && (
                      <span className="text-destructive"> *</span>
                    )}
                  </label>
                  <div className="mt-1.5">
                    <EscalationFieldInput
                      field={field}
                      value={values[field.id] ?? ""}
                      onChange={(value) =>
                        setValues((prev) => ({ ...prev, [field.id]: value }))
                      }
                      className="bg-background focus:ring-ring/50 w-full rounded-xl border px-3.5 py-2.5 text-sm outline-none focus:ring-2"
                    />
                  </div>
                </div>
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
            <h2 className="text-2xl leading-snug font-bold">
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
                  <span className="text-base font-bold">{desk.name}</span>
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
            <h2 className="text-2xl leading-snug font-bold">
              How would you like to contact {activeDesk.name}?
            </h2>
            <div className="mt-5 space-y-3">
              {activeDesk.channels.map((channel) => {
                const availability = channelAvailabilityNow(
                  channel.availability
                );
                const actionable =
                  channel.target !== null || channel.form !== null;
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
                    <div>
                      <div className="flex items-center gap-2.5">
                        <span className="text-lg font-bold">
                          {channel.name}
                        </span>
                        <span className="bg-card ring-border inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1">
                          <span
                            className={`size-1.5 rounded-full ${
                              availability.available
                                ? "bg-emerald-500"
                                : "bg-muted-foreground/60"
                            }`}
                          />
                          {availability.available ? "Available" : "Unavailable"}
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
                      aria-label={`Contact via ${channel.name}`}
                      onClick={() => openForm(channel)}
                      className={`${rowClass} hover:bg-muted transition-colors`}
                    >
                      {body}
                    </button>
                  );
                }
                if (channel.target) {
                  const external = /^https?:/.test(channel.target);
                  return (
                    <a
                      key={channel.id}
                      href={channel.target}
                      {...(external
                        ? { target: "_blank", rel: "noopener noreferrer" }
                        : {})}
                      aria-label={`Contact via ${channel.name}`}
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
