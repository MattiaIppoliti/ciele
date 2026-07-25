"use client";

import { useEffect, useState } from "react";
import type {
  EscalationChannel,
  EscalationFormField,
  EscalationHelpDesk,
} from "@/lib/escalation-desks";
import { initialEscalationDesk } from "@/lib/escalation-desks";
import { channelAvailabilityNow } from "@/lib/channel-availability";
import { ArrowRight, ChevronLeft, LoaderCircle, X } from "lucide-react";

function visitorId(): string {
  const key = "ciele-visitor";
  let id = localStorage.getItem(key);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(key, id);
  }
  return id;
}

/** One escalation-form input, rendered by the field's configured type. */
export function EscalationFieldInput({
  field,
  value,
  onChange,
  className,
}: {
  field: EscalationFormField;
  value: string;
  onChange: (value: string) => void;
  className: string;
}) {
  const common = {
    value,
    required: field.required,
    placeholder: field.placeholder || undefined,
    className,
  };
  if (field.type === "long_text") {
    return (
      <textarea
        {...common}
        rows={4}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }
  if (field.type === "dropdown") {
    return (
      <select
        value={value}
        required={field.required}
        className={className}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">{field.placeholder || "Select…"}</option>
        {(field.options ?? []).map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    );
  }
  if (field.type === "checkbox") {
    return (
      <input
        type="checkbox"
        checked={value === "yes"}
        required={field.required}
        className="size-4"
        onChange={(e) => onChange(e.target.checked ? "yes" : "")}
      />
    );
  }
  const type =
    field.type === "user_email"
      ? "email"
      : field.type === "phone"
        ? "tel"
        : field.type === "url"
          ? "url"
          : field.type === "date"
            ? "date"
            : "text";
  return (
    <input {...common} type={type} onChange={(e) => onChange(e.target.value)} />
  );
}

/** Initial values honoring "Use placeholder as default value". */
export function initialFormValues(
  fields: EscalationFormField[]
): Record<string, string> {
  const values: Record<string, string> = {};
  for (const field of fields) {
    values[field.id] =
      field.usePlaceholderAsDefault && field.placeholder
        ? field.placeholder
        : "";
  }
  return values;
}

/** Loaded only when a visitor explicitly opens the support experience. */
export function WidgetEscalation({
  assistantId,
  conversationId,
  brandColor,
  initialHelpDeskId,
  onBack,
  onHide,
}: {
  assistantId: string;
  conversationId: string | null;
  brandColor: string;
  initialHelpDeskId?: string;
  onBack: () => void;
  onHide: () => void;
}) {
  const [desks, setDesks] = useState<EscalationHelpDesk[] | null>(null);
  const [activeDesk, setActiveDesk] = useState<EscalationHelpDesk | null>(null);
  const [activeChannel, setActiveChannel] = useState<EscalationChannel | null>(
    null
  );
  const [values, setValues] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [confirmation, setConfirmation] = useState<{
    text: string;
    /** Honest fallback when the escalation email could not be delivered. */
    mailto?: string | null;
  } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const response = await fetch(`/api/widget/${assistantId}/help-desks`, {
          signal: controller.signal,
        });
        const data = await response.json();
        const loaded: EscalationHelpDesk[] = data.helpDesks ?? [];
        setDesks(loaded);
        setActiveDesk(initialEscalationDesk(loaded, initialHelpDeskId));
      } catch {
        if (!controller.signal.aborted) setDesks([]);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void load();
    return () => controller.abort();
  }, [assistantId, initialHelpDeskId]);

  function back() {
    if (confirmation) {
      setConfirmation(null);
      setActiveChannel(null);
    } else if (activeChannel) setActiveChannel(null);
    else if (activeDesk && (desks?.length ?? 0) > 1) setActiveDesk(null);
    else onBack();
  }

  function openForm(channel: EscalationChannel) {
    setValues(initialFormValues(channel.form?.fields ?? []));
    setActiveChannel(channel);
  }

  function recordEscalation(helpDeskId: string) {
    if (!conversationId) return;
    fetch(`/api/widget/${assistantId}/escalation`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        visitorId: visitorId(),
        conversationId,
        helpDeskId,
      }),
    }).catch(() => {});
  }

  async function submitForm() {
    if (!activeDesk || !activeChannel?.form || submitting) return;
    setSubmitting(true);
    try {
      const response = await fetch(`/api/widget/${assistantId}/escalation`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          visitorId: visitorId(),
          conversationId,
          helpDeskId: activeDesk.id,
          channelId: activeChannel.id,
          fields: values,
        }),
      });
      if (!response.ok) throw new Error("Submission failed");
      const data = (await response.json().catch(() => ({}))) as {
        email?: { delivered: boolean; fallbackAddress: string | null };
      };
      if (data.email && !data.email.delivered) {
        setConfirmation({
          text: "We couldn't send your request automatically. Please email the team directly instead.",
          mailto: data.email.fallbackAddress,
        });
      } else {
        setConfirmation({
          text:
            activeChannel.form.confirmationMessage.trim() ||
            "Thanks! Your request has been sent — our team will get back to you.",
        });
      }
    } catch {
      setConfirmation({
        text: "Something went wrong sending your request. Please try again.",
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="text-foreground flex h-screen flex-col bg-background"
      style={{ ["--brand" as string]: brandColor }}
    >
      <div className="flex items-center justify-between px-4 py-4">
        <button
          type="button"
          onClick={back}
          className="flex items-center gap-2 rounded-xl border px-4 py-2 text-sm font-semibold transition-colors hover:bg-muted"
        >
          <ChevronLeft className="size-4" strokeWidth={3} /> Back
        </button>
        <button type="button" aria-label="Hide chat" onClick={onHide} className="rounded p-1.5 hover:bg-muted">
          <X className="size-5" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-5 pb-6">
        {loading && (
          <p className="text-muted-foreground flex items-center gap-2 pt-6 text-sm">
            <LoaderCircle className="size-4 animate-spin" /> Loading support options…
          </p>
        )}
        {!loading && desks?.length === 0 && (
          <p className="text-muted-foreground pt-6 text-sm">
            No support channels are available right now.
          </p>
        )}

        {/* Confirmation after a form submission */}
        {confirmation && (
          <div className="pt-6 text-[15px] leading-relaxed">
            <p>{confirmation.text}</p>
            {confirmation.mailto && (
              <a
                href={`mailto:${confirmation.mailto}`}
                className="mt-3 inline-block font-semibold underline"
              >
                {confirmation.mailto}
              </a>
            )}
          </div>
        )}

        {/* Channel form ("Helpdesk form") */}
        {!confirmation && activeChannel?.form && (
          <>
            <h2 className="text-2xl leading-snug font-bold">
              {activeChannel.form.title}
            </h2>
            <form
              className="mt-5 space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                void submitForm();
              }}
            >
              {activeChannel.form.fields.map((field) => (
                <div key={field.id}>
                  <label className="block text-sm font-semibold">
                    {field.label}
                    {field.required && <span className="text-red-600"> *</span>}
                  </label>
                  <div className="mt-1.5">
                    <EscalationFieldInput
                      field={field}
                      value={values[field.id] ?? ""}
                      onChange={(value) =>
                        setValues((prev) => ({ ...prev, [field.id]: value }))
                      }
                      className="bg-background w-full rounded-xl border px-3.5 py-2.5 text-sm outline-none focus:ring-2"
                    />
                  </div>
                </div>
              ))}
              <button
                type="submit"
                disabled={submitting}
                className="w-full rounded-xl px-4 py-3 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
                style={{ backgroundColor: brandColor }}
              >
                {submitting ? "Sending…" : "Submit"}
              </button>
            </form>
          </>
        )}

        {/* Desk list */}
        {!loading && !confirmation && !activeChannel && !activeDesk && (desks?.length ?? 0) > 1 && (
          <>
            <h2 className="text-2xl leading-snug font-bold">How would you like to contact us?</h2>
            <div className="mt-5 space-y-3">
              {desks!.map((desk) => (
                <button
                  key={desk.id}
                  type="button"
                  onClick={() => setActiveDesk(desk)}
                  className="bg-muted hover:bg-muted/80 flex w-full items-center justify-between gap-3 rounded-2xl px-5 py-4 text-left transition-colors"
                >
                  <span className="text-base font-bold">{desk.name}</span>
                  <span className="bg-background flex size-10 shrink-0 items-center justify-center rounded-xl border">
                    <ArrowRight className="size-4" />
                  </span>
                </button>
              ))}
            </div>
          </>
        )}

        {/* Channel list for the chosen desk */}
        {!loading && !confirmation && !activeChannel && activeDesk && (
          <>
            <h2 className="text-2xl leading-snug font-bold">
              How would you like to contact {activeDesk.name}?
            </h2>
            <div className="mt-5 space-y-3">
              {activeDesk.channels.map((channel) => {
                const availability = channelAvailabilityNow(channel.availability);
                const actionable = channel.target !== null || channel.form !== null;
                const arrow = (
                  <span
                    className={`bg-background flex size-10 shrink-0 items-center justify-center rounded-xl border ${
                      actionable ? "" : "opacity-40"
                    }`}
                  >
                    <ArrowRight className="size-4" />
                  </span>
                );
                const body = (
                  <>
                    <div>
                      <div className="flex items-center gap-2.5">
                        <span className="text-lg font-bold">{channel.name}</span>
                        <span className="bg-background text-muted-foreground ring-border inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1">
                          <span className={`size-1.5 rounded-full ${availability.available ? "bg-emerald-500" : "bg-neutral-400"}`} />
                          {availability.available ? "Available" : "Unavailable"}
                        </span>
                      </div>
                      {!availability.available && availability.nextWindow && (
                        <p className="text-muted-foreground mt-1.5 text-sm">
                          Next available: {availability.nextWindow}
                        </p>
                      )}
                      {!actionable && (
                        <p className="text-muted-foreground mt-1.5 text-sm">
                          Not yet available in chat — ask the team about this
                          option.
                        </p>
                      )}
                    </div>
                    {arrow}
                  </>
                );
                const rowClass =
                  "flex w-full items-center justify-between gap-3 rounded-2xl bg-muted px-5 py-4 text-left transition-colors";
                if (channel.form) {
                  return (
                    <button
                      key={channel.id}
                      type="button"
                      aria-label={`Contact via ${channel.name}`}
                      onClick={() => openForm(channel)}
                      className={`${rowClass} hover:bg-muted/80`}
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
                      onClick={() => recordEscalation(activeDesk.id)}
                      className={`${rowClass} hover:bg-muted/80`}
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
            </div>
          </>
        )}
      </div>
    </div>
  );
}
