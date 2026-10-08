"use client";

import { SlotPortal, TOP_BAR_SLOT } from "@/components/shell/slot-portal";
import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { HelpDesk } from "@agent-hub/core";
import { ArrowUpRight, Headset, Plus } from "lucide-react";
import { toast } from "@/lib/toast";
import { createHelpDeskAction } from "@/app/actions";
import { DialogBody, DialogSection, DialogFooter, Button } from "@agent-hub/ui";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@agent-hub/ui";
import { Input } from "@agent-hub/ui";
import { Label } from "@agent-hub/ui";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState } from "@/components/ui/empty-state";
import { RollInText, RollRow } from "@/components/motion/roll-in-text";
import { RollingNumber } from "@/components/motion/rolling-number";
import { isRedirectError } from "@/components/ui/confirm-delete-modal";
import { formatCount } from "@/lib/format";

const DESCRIPTION_LIMIT = 5000;

/** Presets for the create dialog, name + a ≥200-char description each. */
const TEMPLATES: Array<{ emoji: string; name: string; description: string }> = [
  {
    emoji: "🖥️",
    name: "IT Support",
    description:
      "The IT Support Helpdesk assists employees and customers with access issues, software troubleshooting, network support, and guidance on using internal digital tools efficiently.",
  },
  {
    emoji: "🧠",
    name: "People Support",
    description:
      "People Support helps employees with workplace questions, wellbeing resources, policy guidance, and confidential routes to the right internal team when personal or professional issues need care.",
  },
  {
    emoji: "💼",
    name: "Sales Support",
    description:
      "Sales Support helps prospects and customers with product fit, pricing questions, procurement steps, demo requests, and handoffs to account teams for deeper commercial conversations.",
  },
  {
    emoji: "📚",
    name: "Product Support",
    description:
      "Product Support helps users with account access, feature guidance, workflow troubleshooting, integrations, and practical next steps when something in the product is not working as expected.",
  },
  {
    emoji: "🎓",
    name: "Customer Operations",
    description:
      "Customer Operations supports customers with administrative procedures such as records, account updates, billing questions, subscription changes, and general guidance on service processes.",
  },
  {
    emoji: "💰",
    name: "Billing",
    description:
      "The Billing team helps customers with invoices, payment methods, tax details, plan changes, refunds, and account-specific billing questions that need a finance or operations review.",
  },
  {
    emoji: "♿",
    name: "Accessibility Services",
    description:
      "Accessibility Services helps users and employees access products, services, and materials through accommodations, assistive technology guidance, accessible formats, and individual support plans.",
  },
  {
    emoji: "📋",
    name: "Onboarding",
    description:
      "The Onboarding team assists new customers and partners through setup, requirements, timelines, configuration options, and launch steps to ensure a smooth transition into the service.",
  },
];

function CreateHelpDeskDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [template, setTemplate] = useState<string | null>(null);
  const [nameError, setNameError] = useState(false);
  // Set when a paste ran past the limit, so the cut is said out loud instead
  // of the tail quietly going missing.
  const [clipped, setClipped] = useState(false);
  const [isPending, startTransition] = useTransition();

  function pick(t: { name: string; description: string } | null) {
    setTemplate(t?.name ?? "blank");
    setName(t?.name ?? "");
    setDescription(t?.description ?? "");
    setNameError(false);
    setClipped(false);
  }

  function handleCreate() {
    if (!name.trim()) {
      setNameError(true);
      document.getElementById("desk-name")?.focus();
      return;
    }
    startTransition(async () => {
      try {
        const desk = await createHelpDeskAction({
          name: name.trim(),
          description,
        });
        toast.success(`"${desk.name}" created`);
        onClose();
        router.push(`/help-desks/${desk.id}`);
      } catch (error) {
        if (isRedirectError(error)) throw error;
        // The dialog stays open, so nothing typed is lost to a failed create.
        toast.error(
          error instanceof Error ? error.message : "Could not create the help desk",
        );
      }
    });
  }

  return (
    // A close mid-create would hide whether the desk exists yet.
    <Dialog open={open} onOpenChange={(o) => !o && !isPending && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-xl">Create a Help Desk</DialogTitle>
        </DialogHeader>

        <DialogBody>
          <DialogSection>
            <div className="space-y-2">
              <p className="font-semibold">Choose a template</p>

              <div className="grid grid-cols-2 gap-3 pt-2 sm:grid-cols-3">
                {TEMPLATES.map((t) => (
                  <button
                    key={t.name}
                    type="button"
                    aria-pressed={template === t.name}
                    onClick={() => pick(t)}
                    className={`flex flex-col items-center gap-2 rounded-xl border px-3 py-4 text-sm font-medium transition-colors ${
                      template === t.name
                        ? "border-primary ring-primary/30 shadow-light ring-1"
                        : "hover:bg-muted/50"
                    }`}
                  >
                    <span aria-hidden className="text-2xl">
                      {t.emoji}
                    </span>
                    {t.name}
                  </button>
                ))}
                <button
                  type="button"
                  aria-pressed={template === "blank"}
                  onClick={() => pick(null)}
                  className={`flex flex-col items-center gap-2 rounded-xl border px-3 py-4 text-sm font-medium transition-colors ${
                    template === "blank"
                      ? "border-primary ring-primary/30 shadow-light ring-1"
                      : "hover:bg-muted/50"
                  }`}
                >
                  <Plus aria-hidden className="size-7" />
                  Blank
                </button>
              </div>
            </div>
          </DialogSection>

          <DialogSection>
            <div className="space-y-2">
              <Label htmlFor="desk-name">
                Help Desk Name <span className="text-destructive">*</span>
              </Label>
              <Input
                id="desk-name"
                autoComplete="off"
                value={name}
                aria-invalid={nameError || undefined}
                aria-describedby={nameError ? "desk-name-error" : undefined}
                onChange={(e) => {
                  setName(e.target.value);
                  setNameError(false);
                }}
              />
              {nameError && (
                <p id="desk-name-error" className="text-destructive text-sm">
                  Help desk name is required.
                </p>
              )}
            </div>
          </DialogSection>

          <DialogSection>
            <div className="space-y-2">
              <Label htmlFor="desk-description">Description</Label>
              <Textarea
                id="desk-description"
                value={description}
                onChange={(e) => {
                  setClipped(e.target.value.length > DESCRIPTION_LIMIT);
                  setDescription(e.target.value.slice(0, DESCRIPTION_LIMIT));
                }}
                placeholder="Describe what this help desk handles…"
                rows={6}
                aria-describedby="desk-description-count"
              />
              <p
                id="desk-description-count"
                className="text-muted-foreground text-right text-xs"
              >
                <RollingNumber value={description.length} />/
                {formatCount(DESCRIPTION_LIMIT)}
              </p>
              {description.length >= DESCRIPTION_LIMIT && (
                <p role="status" className="text-destructive text-sm">
                  {clipped
                    ? `Only the first ${formatCount(DESCRIPTION_LIMIT)} characters were kept.`
                    : `The description is at its ${formatCount(DESCRIPTION_LIMIT)}-character limit.`}
                </p>
              )}
              <p className="text-muted-foreground text-sm">
                200+ characters recommended for AI matching.
              </p>
            </div>
          </DialogSection>
        </DialogBody>

        <DialogFooter className="flex justify-end gap-2 border-t pt-4">
          <Button
            variant="outline"
            className="h-10 px-5"
            onClick={onClose}
            disabled={isPending}
          >
            Cancel
          </Button>
          <Button
            loading={isPending}
            className="h-10 px-5"
            onClick={handleCreate}
            disabled={isPending}
          >
            <RollInText text={isPending ? "Creating…" : "Create Help Desk"} />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function HelpDesksClient({
  desks,
  canEdit,
}: {
  desks: HelpDesk[];
  canEdit: boolean;
}) {
  const [createOpen, setCreateOpen] = useState(false);

  return (
    <div className="touch-scroll-clearance flex h-full flex-col overflow-y-auto">
      <h1 className="sr-only">Help Desks</h1>
      {canEdit && (
        <SlotPortal id={TOP_BAR_SLOT}>
          <Button
            className="h-8 rounded-lg px-3 font-semibold"
            onClick={() => setCreateOpen(true)}
          >
            Add Help Desk
          </Button>
        </SlotPortal>
      )}

      {/* Nothing here at all is a screen, not a cell in the grid: the
          create-a-desk tile is a good affordance beside desks that exist and a
          poor first impression on its own, so the empty case replaces the grid
          rather than sitting inside it. */}
      {desks.length === 0 ? (
        <EmptyState
          className="flex-1"
          title="No help desks yet"

        >
          {canEdit && (
            <Button
              className="h-10 rounded-lg px-5 font-semibold"
              onClick={() => setCreateOpen(true)}
            >
              Create New Help Desk
            </Button>
          )}
        </EmptyState>
      ) : (
      <div className="overview-panels grid grid-cols-1 gap-6 border-t px-6 py-6 lg:grid-cols-2">
        {desks.map((desk, index) => (
          <RollRow key={desk.id} index={index}>
          <Link
            href={`/help-desks/${desk.id}`}
            aria-label={`Manage ${desk.name}`}
            data-slot="overview-card"
            className="overview-card press flex min-w-0 flex-col outline-none"
          >
            <div
              data-slot="overview-card-content"
              className="overview-card-content flex min-h-32 min-w-0 flex-1 items-start p-5"
            >
              {desk.description && (<p className="text-muted-foreground line-clamp-3 text-sm leading-relaxed break-words">
                {desk.description}
              </p>)}
            </div>
            <div
              data-slot="overview-card-caption"
              className="overview-card-caption flex flex-wrap items-center justify-between gap-3 px-3 py-3"
            >
              <div className="flex min-w-0 flex-1 basis-36 items-center gap-3">
                <span
                  data-slot="overview-card-icon"
                  className="overview-card-icon flex size-9 shrink-0 items-center justify-center rounded-full"
                  aria-hidden="true"
                >
                  <Headset className="size-4" />
                </span>
                <h2 className="min-w-0 text-sm font-medium break-words">
                  <RollInText text={desk.name} />
                </h2>
              </div>
              <span className="overview-card-link text-muted-foreground flex shrink-0 items-center gap-1.5 text-xs font-medium">
                Manage Desk
                <ArrowUpRight className="overview-card-arrow size-4" aria-hidden="true" />
              </span>
            </div>
          </Link>
          </RollRow>
        ))}

        {canEdit && (
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            data-slot="overview-card"
            className="overview-card press flex min-w-0 flex-col text-left outline-none"
          >
            <span
              data-slot="overview-card-content"
              className="overview-card-content text-muted-foreground flex min-h-32 flex-1 items-center justify-center p-5"
            >
              <Plus className="size-6" aria-hidden="true" />
            </span>
            <span
              data-slot="overview-card-caption"
              className="overview-card-caption overview-card-link flex items-center gap-3 px-3 py-3 text-sm font-medium"
            >
              <span
                data-slot="overview-card-icon"
                className="overview-card-icon flex size-9 shrink-0 items-center justify-center rounded-full"
                aria-hidden="true"
              >
                <Plus className="size-4" />
              </span>
              <span className="min-w-0 flex-1">Create New Help Desk</span>
              <ArrowUpRight className="overview-card-arrow size-4" aria-hidden="true" />
            </span>
          </button>
        )}
      </div>
      )}

      <CreateHelpDeskDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
      />
    </div>
  );
}
