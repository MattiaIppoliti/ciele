"use client";

import { useState, useTransition } from "react";
import type { Assistant } from "@agent-hub/core";
import { ExternalLink, Plane, RotateCcw, CloudOff } from "lucide-react";
import { toast } from "@/lib/toast";
import { useBrowserOrigin } from "@/lib/hooks/use-browser-origin";
import { AnimatedIcon } from "@/components/ui/animated-icon";
import {
  publishAssistantAction,
  republishAction,
  unpublishAssistantAction,
  updateAssistantAction,
} from "@/app/actions";
import { MorphingModal } from "@/components/motion/morphing-modal";
import {
  SectionTimeline,
  TimelineSection,
} from "@/components/settings/section-timeline";
import { SlideToConfirm } from "@/components/ui/slide-to-confirm";
import {
  Badge,
  Button,
  Card,
  CopyFeedbackIcon,
  Input,
  Label,
  cn,
  useCopyFeedback,
} from "@agent-hub/ui";
import { formatDateTime } from "@/lib/format";
import { RollInText } from "@/components/motion/roll-in-text";
import { RollingNumber } from "@/components/motion/rolling-number";
import {
  isRedirectError,
  useConfirmDelete,
} from "@/components/ui/confirm-delete-modal";

interface PublicationSummary {
  id: string;
  version: number;
  createdAt: string;
}

function CopyBlock({ label, code }: { label: string; code: string }) {
  const { copyText, isCopied } = useCopyFeedback<string>();
  const copied = isCopied(code);

  async function copyCode() {
    if (await copyText(code, code)) toast.success("Copied");
    else toast.error("Could not copy the code");
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">{label}</p>
        <Button
          variant="ghost"
          size="sm"
          aria-label={`Copy ${label}`}
          onClick={() => void copyCode()}
        >
          <CopyFeedbackIcon copied={copied} className="size-3.5" />
          <RollInText text={copied ? "Copied" : "Copy"} />
        </Button>
      </div>
      <pre className="bg-muted mt-1 overflow-x-auto rounded-xl p-3 text-xs leading-relaxed">
        {code}
      </pre>
    </div>
  );
}

export function PublishClient({
  assistant,
  publications,
  canPublish,
}: {
  assistant: Assistant;
  publications: PublicationSummary[];
  canPublish: boolean;
}) {
  const [domains, setDomains] = useState(
    (assistant.allowedDomains ?? []).join(", ")
  );
  const [confirmView, setConfirmView] = useState<string | null>(null);
  // One transition per action, so saving the domains never reads as
  // "Publishing…" and each button reports only its own work.
  const [savingDomains, startSaveDomains] = useTransition();
  const [publishing, startPublish] = useTransition();
  const [unpublishing, startUnpublish] = useTransition();
  const busy = publishing || unpublishing;
  const { confirmDelete, confirmDeleteModal } = useConfirmDelete();

  const origin = useBrowserOrigin();

  const latest = publications[0] ?? null;
  const domainsDirty = domains !== (assistant.allowedDomains ?? []).join(", ");

  const scriptSnippet = `<script src="${origin}/widget.js"\n        data-assistant="${assistant.id}"\n        async></script>`;
  const drawerSnippet = `<script src="${origin}/widget.js"\n        data-assistant="${assistant.id}"\n        data-mode="drawer"\n        async></script>`;
  const iframeSnippet = `<iframe src="${origin}/widget/${assistant.id}"\n        width="380" height="640"\n        allow="clipboard-write; microphone"\n        style="border:none;border-radius:16px"></iframe>`;

  function saveDomains() {
    startSaveDomains(async () => {
      try {
        await updateAssistantAction(assistant.id, {
          allowedDomains: domains
            .split(",")
            .map((d) => d.trim())
            .filter(Boolean),
        });
        toast.success("Allowed domains saved, publish to make them live");
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Could not save the allowed domains");
      }
    });
  }

  function publish() {
    setConfirmView(null);
    startPublish(async () => {
      try {
        const result = await publishAssistantAction(assistant.id);
        if (typeof result === "object") {
          // The refusal names the Flow to fix (a Connector on a dead or
          // personal Connection, #839); nothing was published.
          toast.error(result.error);
          return;
        }
        toast.success(`Published v${result}, the widget now serves this snapshot`);
      } catch (error) {
        if (isRedirectError(error)) throw error;
        toast.error(error instanceof Error ? error.message : "Could not publish");
      }
    });
  }

  function unpublish() {
    setConfirmView(null);
    startUnpublish(async () => {
      try {
        await unpublishAssistantAction(assistant.id);
        toast.success("Unpublished, the widget is offline until the next publish");
      } catch (error) {
        if (isRedirectError(error)) throw error;
        toast.error(error instanceof Error ? error.message : "Could not unpublish");
      }
    });
  }

  function republish(p: PublicationSummary) {
    // A rollback replaces what every embed serves, so it asks first, like
    // Publish does.
    confirmDelete({
      title: `Republish v${p.version}?`,
      description:
        "This snapshot goes live again as a new version on every page the widget is embedded on.",
      confirmLabel: "Republish",
      onConfirm: async () => {
        const version = await republishAction(assistant.id, p.id);
        toast.success(`Rolled back, republished as v${version}`);
      },
    });
  }

  return (
    <div className="pt-8 pb-16">
      <SectionTimeline>
      {/* Allowed domains */}
      <TimelineSection title="Allowed domains">
      <Card size="sm" className="gap-0 p-4">
        <p className="text-muted-foreground text-sm">
          Restrict where the widget may be embedded. Leave empty to allow any
          origin. Brand color and launcher placement live in{" "}
          <span className="font-medium">Style</span>.
        </p>
        <div className="mt-4 flex flex-wrap items-end gap-4">
          <div className="min-w-64 flex-1 space-y-2">
            <Label htmlFor="domains">Domains</Label>
            <Input
              id="domains"
              name="allowedDomains"
              autoComplete="off"
              spellCheck={false}
              value={domains}
              onChange={(e) => setDomains(e.target.value)}
              placeholder="example.com, app.example.com"
            />
          </div>
          <Button
            onClick={saveDomains}
            disabled={savingDomains || !domainsDirty}
            variant="outline"
          >
            <RollInText text={savingDomains ? "Saving…" : "Save"} />
          </Button>
        </div>
      </Card>
      </TimelineSection>

      <TimelineSection title="Publication">
      {/* Publish, live state is the one thing on this page worth reading from
          across the room, so a published assistant tints its own card: an
          emerald edge plus a wash that fades out towards the buttons, leaving
          them on the plain card surface. Unpublished keeps the neutral card,
          which is what makes the tint mean something. */}
      <Card
        size="sm"
        className={cn(
          "gap-0 p-4",
          // `Card` draws its outline as a ring, not a border, so the emerald
          // edge has to override `ring-foreground/10`, a `border-*` class only
          // colours a border that is zero pixels wide.
          latest &&
            "ring-emerald-500/40 bg-gradient-to-r from-emerald-500/10 via-emerald-500/5 to-transparent dark:from-emerald-500/15 dark:via-emerald-500/[0.06]",
          // A lit top edge: a hairline that brightens in the middle and fades at
          // both corners (`after`), over a soft bloom that spills a few pixels
          // down into the card (`before`). `overflow-hidden` keeps both inside
          // the rounded corners.
          latest &&
            "relative overflow-hidden " +
              "before:pointer-events-none before:absolute before:inset-x-8 before:-top-6 before:h-12 before:rounded-[50%] before:bg-emerald-400/25 before:blur-xl before:content-[''] dark:before:bg-emerald-400/30 " +
              "after:pointer-events-none after:absolute after:inset-x-0 after:top-0 after:h-px after:bg-[linear-gradient(to_right,transparent,var(--color-emerald-400)_50%,transparent)] after:opacity-70 after:content-[''] dark:after:opacity-90"
        )}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold">
              {latest ? (
                <>
                  Live: v<RollingNumber value={latest.version} />
                </>
              ) : (
                "Not published yet"
              )}
            </h2>
            <p className="text-muted-foreground mt-1 text-sm">
              {latest
                ? `Published ${formatDateTime(latest.createdAt)}`
                : "The widget stays offline until the first publish."}
            </p>
          </div>
          {canPublish ? (
            <div className="flex items-center gap-2">
              {latest && (
                <Button
                  variant="destructive"
                  onClick={() => setConfirmView("unpublish")}
                  disabled={busy}
                >
                  <CloudOff className="size-4" /> Unpublish
                </Button>
              )}
              <Button
                onClick={() => setConfirmView("publish")}
                disabled={busy}
                className="px-6 font-semibold"
              >
                <AnimatedIcon icon={Plane} size={16} />
                <RollInText
                  text={publishing ? "Publishing…" : latest ? "Publish new version" : "Publish"}
                />
              </Button>
            </div>
          ) : (
            <Badge variant="secondary">Publishing requires admin/owner role</Badge>
          )}
        </div>

        {publications.length > 1 && (
          <div className="mt-4 space-y-1 border-t pt-4">
            <p className="text-muted-foreground mb-2 text-xs font-semibold">Previous versions</p>
            {publications.slice(1).map((p) => (
              <div key={p.id} className="flex items-center gap-3 rounded-lg px-2 py-1.5 text-sm">
                <span className="font-mono">v{p.version}</span>
                <span className="text-muted-foreground min-w-0 flex-1 truncate text-xs">
                  <RollInText text={formatDateTime(p.createdAt)} />
                </span>
                {canPublish && (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    onClick={() => republish(p)}
                  >
                    <AnimatedIcon icon={RotateCcw} size={14} /> Republish
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>

      </TimelineSection>

      {/* Embed */}
      <TimelineSection title="Website & embed">
      <Card size="sm" className="gap-0 p-4">
        <p className="text-muted-foreground text-sm">
          Add a chat button to any page, or embed the chat inline.
        </p>
        <div className="mt-4 space-y-5">
          <CopyBlock
            label="Website, floating card (launcher opens a rounded panel)"
            code={scriptSnippet}
          />
          <CopyBlock
            label="Website, side drawer (launcher opens a flush full-height panel)"
            code={drawerSnippet}
          />
          <CopyBlock label="iFrame (inline)" code={iframeSnippet} />
          <a
            href={`/widget/${assistant.id}`}
            target="_blank"
            rel="noreferrer"
            className="text-primary inline-flex items-center gap-1.5 text-sm font-medium hover:underline"
          >
            Open the published widget <ExternalLink className="size-3.5" />
          </a>
        </div>
      </Card>
      </TimelineSection>
      </SectionTimeline>

      <MorphingModal
        viewId={confirmView}
        title={
          confirmView === "publish"
            ? latest
              ? "Publish new version?"
              : "Publish this assistant?"
            : "Unpublish this assistant?"
        }
        onClose={() => setConfirmView(null)}
        placement="bottom"
      >
        {confirmView === "publish" ? (
          <div className="space-y-4">
            <div className="flex items-start gap-3">
              <div className="bg-primary/10 text-primary rounded-full p-2">
                <AnimatedIcon icon={Plane} size={20} />
              </div>
              <div>
                <h3 className="text-base font-semibold">
                  {latest ? "Publish new version?" : "Publish this assistant?"}
                </h3>
                <p className="text-muted-foreground mt-1 text-sm leading-relaxed">
                  A new snapshot goes live to every page the widget is embedded
                  on. Slide to confirm.
                </p>
              </div>
            </div>
            <div className="flex justify-center">
              <SlideToConfirm
                onConfirm={publish}
                label="Slide to publish"
                confirmedLabel="Publishing"
              />
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-start gap-3">
              <div className="bg-destructive/10 text-destructive rounded-full p-2">
                <CloudOff className="size-5" />
              </div>
              <div>
                <h3 className="text-base font-semibold">Unpublish this assistant?</h3>
                <p className="text-muted-foreground mt-1 text-sm leading-relaxed">
                  The widget goes offline everywhere it is embedded
                  {latest ? ` (currently v${latest.version})` : ""} and previous
                  versions are removed. You can publish again at any time.
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setConfirmView(null)}>
                Cancel
              </Button>
              <Button variant="destructive" onClick={unpublish} disabled={busy}>
                <CloudOff className="size-4" /> Unpublish
              </Button>
            </div>
          </div>
        )}
      </MorphingModal>
      {confirmDeleteModal}
    </div>
  );
}
