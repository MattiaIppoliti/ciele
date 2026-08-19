"use client";

import { useState, useSyncExternalStore, useTransition } from "react";
import type { Assistant } from "@agent-hub/core";
import { ExternalLink, Plane, RotateCcw, CloudOff } from "lucide-react";
import { toast } from "@/lib/toast";
import { AnimatedIcon } from "@/components/ui/animated-icon";
import {
  publishAssistantAction,
  republishAction,
  unpublishAssistantAction,
  updateAssistantAction,
} from "@/app/actions";
import { MorphingModal } from "@/components/motion/morphing-modal";
import { SwipeButton } from "@/components/motion/swipe-button";
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

interface PublicationSummary {
  id: string;
  version: number;
  createdAt: string;
}

/** No-op store subscription: window.location.origin never changes at runtime. */
const NOOP_SUBSCRIBE = () => () => {};

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
          onClick={() => void copyCode()}
        >
          <CopyFeedbackIcon copied={copied} className="size-3.5" />
          {copied ? "Copied" : "Copy"}
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
  const [isPending, startTransition] = useTransition();

  // Read the browser origin after hydration (SSR renders the placeholder) via
  // useSyncExternalStore, avoids both a hydration mismatch and setState-in-effect.
  const origin = useSyncExternalStore(
    NOOP_SUBSCRIBE,
    () => window.location.origin,
    () => "https://your-app.example"
  );

  const latest = publications[0] ?? null;
  const domainsDirty = domains !== (assistant.allowedDomains ?? []).join(", ");

  const scriptSnippet = `<script src="${origin}/widget.js"\n        data-assistant="${assistant.id}"\n        async></script>`;
  const drawerSnippet = `<script src="${origin}/widget.js"\n        data-assistant="${assistant.id}"\n        data-mode="drawer"\n        async></script>`;
  const iframeSnippet = `<iframe src="${origin}/widget/${assistant.id}"\n        width="380" height="640"\n        style="border:none;border-radius:16px"></iframe>`;

  function saveDomains() {
    startTransition(async () => {
      await updateAssistantAction(assistant.id, {
        allowedDomains: domains
          .split(",")
          .map((d) => d.trim())
          .filter(Boolean),
      });
      toast.success("Allowed domains saved, publish to make them live");
    });
  }

  function publish() {
    setConfirmView(null);
    startTransition(async () => {
      const version = await publishAssistantAction(assistant.id);
      toast.success(`Published v${version}, the widget now serves this snapshot`);
    });
  }

  function unpublish() {
    setConfirmView(null);
    startTransition(async () => {
      await unpublishAssistantAction(assistant.id);
      toast.success("Unpublished, the widget is offline until the next publish");
    });
  }

  return (
    <div className="space-y-8 pt-8 pb-16">
      {/* Allowed domains */}
      <Card size="sm" className="gap-0 p-4">
        <h2 className="text-base font-semibold">Allowed domains</h2>
        <p className="text-muted-foreground mt-1 text-sm">
          Restrict where the widget may be embedded. Leave empty to allow any
          origin. Brand color and launcher placement live in{" "}
          <span className="font-medium">Style</span>.
        </p>
        <div className="mt-4 flex flex-wrap items-end gap-4">
          <div className="min-w-64 flex-1 space-y-2">
            <Label htmlFor="domains">Domains</Label>
            <Input
              id="domains"
              value={domains}
              onChange={(e) => setDomains(e.target.value)}
              placeholder="example.com, app.example.com"
            />
          </div>
          <Button
            onClick={saveDomains}
            disabled={isPending || !domainsDirty}
            variant="outline"
          >
            Save
          </Button>
        </div>
      </Card>

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
              {latest ? `Live: v${latest.version}` : "Not published yet"}
            </h2>
            <p className="text-muted-foreground mt-1 text-sm">
              {latest
                ? `Published ${new Date(latest.createdAt).toLocaleString()}`
                : "The widget stays offline until the first publish."}
            </p>
          </div>
          {canPublish ? (
            <div className="flex items-center gap-2">
              {latest && (
                <Button
                  variant="destructive"
                  onClick={() => setConfirmView("unpublish")}
                  disabled={isPending}
                >
                  <CloudOff className="size-4" /> Unpublish
                </Button>
              )}
              <Button
                onClick={() => setConfirmView("publish")}
                disabled={isPending}
                className="px-6 font-semibold"
              >
                <AnimatedIcon icon={Plane} size={16} />
                {isPending ? "Publishing..." : latest ? "Publish new version" : "Publish"}
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
                  {new Date(p.createdAt).toLocaleString()}
                </span>
                {canPublish && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      startTransition(async () => {
                        const version = await republishAction(assistant.id, p.id);
                        toast.success(`Rolled back, republished as v${version}`);
                      })
                    }
                  >
                    <AnimatedIcon icon={RotateCcw} size={14} /> Republish
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Embed */}
      <Card size="sm" className="gap-0 p-4">
        <h2 className="text-base font-semibold">Website &amp; embed</h2>
        <p className="text-muted-foreground mt-1 text-sm">
          Add the floating chat button to any page, opening as a floating
          rounded card or as a flush full-height side drawer, or embed the
          chat inline.
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

      <MorphingModal
        viewId={confirmView}
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
                  on. Swipe to confirm.
                </p>
              </div>
            </div>
            <SwipeButton
              text="Swipe to publish"
              onSwipeComplete={publish}
              className="pointer-events-auto"
            />
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
              <Button variant="destructive" onClick={unpublish} disabled={isPending}>
                <CloudOff className="size-4" /> Unpublish
              </Button>
            </div>
          </div>
        )}
      </MorphingModal>
    </div>
  );
}
