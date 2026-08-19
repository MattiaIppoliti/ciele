"use client";

import { useState, useTransition } from "react";
import { Link } from "@/components/ui/link";
import { useRouter } from "next/navigation";
import type { HelpDesk } from "@agent-hub/core";
import { Plus } from "lucide-react";
import { toast } from "@/lib/toast";
import { createHelpDeskAction } from "@/app/actions";
import { Button } from "@agent-hub/ui";
import { Card } from "@agent-hub/ui";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@agent-hub/ui";
import { Input } from "@agent-hub/ui";
import { Label } from "@agent-hub/ui";
import { Textarea } from "@/components/ui/textarea";

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
  const [isPending, startTransition] = useTransition();

  function pick(t: { name: string; description: string } | null) {
    setTemplate(t?.name ?? "blank");
    setName(t?.name ?? "");
    setDescription(t?.description ?? "");
  }

  function handleCreate() {
    if (!name.trim()) {
      toast.error("Help desk name is required");
      return;
    }
    startTransition(async () => {
      const desk = await createHelpDeskAction({
        name: name.trim(),
        description,
      });
      toast.success(`"${desk.name}" created`);
      onClose();
      router.push(`/help-desks/${desk.id}`);
    });
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-xl">Create a Help Desk</DialogTitle>
        </DialogHeader>

        <div className="space-y-2">
          <p className="font-semibold">Choose a template</p>
          <p className="text-muted-foreground text-sm">
            Select a preset to pre-fill the name and description, or start
            blank.
          </p>
          <div className="grid grid-cols-2 gap-3 pt-2 sm:grid-cols-3">
            {TEMPLATES.map((t) => (
              <button
                key={t.name}
                type="button"
                onClick={() => pick(t)}
                className={`flex flex-col items-center gap-2 rounded-xl border px-3 py-4 text-sm font-medium transition-colors ${
                  template === t.name
                    ? "border-primary ring-primary/30 shadow-sm ring-1"
                    : "hover:bg-muted/50"
                }`}
              >
                <span className="text-2xl">{t.emoji}</span>
                {t.name}
              </button>
            ))}
            <button
              type="button"
              onClick={() => pick(null)}
              className={`flex flex-col items-center gap-2 rounded-xl border px-3 py-4 text-sm font-medium transition-colors ${
                template === "blank"
                  ? "border-primary ring-primary/30 shadow-sm ring-1"
                  : "hover:bg-muted/50"
              }`}
            >
              <Plus className="size-7" />
              Blank
            </button>
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="desk-name">
            Help Desk Name <span className="text-destructive">*</span>
          </Label>
          <Input
            id="desk-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="desk-description">Description</Label>
          <Textarea
            id="desk-description"
            value={description}
            onChange={(e) =>
              setDescription(e.target.value.slice(0, DESCRIPTION_LIMIT))
            }
            placeholder="Describe what this help desk handles..."
            rows={6}
          />
          <p className="text-muted-foreground text-right text-xs">
            {description.length}/{DESCRIPTION_LIMIT}
          </p>
          <p className="text-muted-foreground text-sm">
            At least 200 characters recommended for best AI recognition.
          </p>
        </div>

        <div className="flex justify-end gap-2 border-t pt-4">
          <Button variant="outline" className="h-10 px-5" onClick={onClose}>
            Cancel
          </Button>
          <Button
            className="h-10 px-5"
            onClick={handleCreate}
            disabled={isPending}
          >
            {isPending ? "Creating..." : "Create Help Desk"}
          </Button>
        </div>
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
    <div className="flex h-full flex-col overflow-y-auto">
      <header className="flex shrink-0 items-center gap-3 px-6 pt-5 pb-4">
        <h1 className="text-2xl font-bold tracking-tight">Help Desks</h1>
        {canEdit && (
          <Button
            className="ml-auto h-10 rounded-lg px-4 font-semibold"
            onClick={() => setCreateOpen(true)}
          >
            Add Help Desk
          </Button>
        )}
      </header>

      <div className="grid grid-cols-1 gap-4 border-t px-6 py-6 lg:grid-cols-2">
        {desks.map((desk) => (
          <Card
            key={desk.id}
            size="sm"
            className="items-start gap-3 p-4"
          >
            <Link
              href={`/help-desks/${desk.id}`}
              className="text-primary text-lg font-bold underline underline-offset-4 hover:opacity-70"
            >
              {desk.name}
            </Link>
            <p className="text-muted-foreground line-clamp-3 text-sm leading-relaxed">
              {desk.description || "No description yet."}
            </p>
            <Button
              variant="outline"
              className="mt-auto h-10 rounded-lg px-5"
              render={<Link href={`/help-desks/${desk.id}`} />}
              nativeButton={false}
            >
              Manage Desk
            </Button>
          </Card>
        ))}

        {canEdit && (
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            className="text-muted-foreground hover:bg-muted/50 hover:text-foreground flex min-h-36 items-center justify-center rounded-xl border border-dashed text-sm font-medium transition-colors"
          >
            Create New Help Desk
          </button>
        )}

        {desks.length === 0 && !canEdit && (
          <p className="text-muted-foreground text-sm">
            No help desks yet. Ask an editor to create one.
          </p>
        )}
      </div>

      <CreateHelpDeskDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
      />
    </div>
  );
}
