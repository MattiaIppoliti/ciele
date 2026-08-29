"use client";

import * as React from "react";
import { MessageCircle, Pencil, RotateCcw, UploadCloud, X } from "lucide-react";
import type { Assistant, WidgetCorner, WidgetStyle } from "@agent-hub/core";
import { toast } from "@/lib/toast";
import { updateAssistantAction } from "@/app/actions";
import { Button, Card, Input, Label, Separator } from "@agent-hub/ui";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@agent-hub/ui";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { ColorPicker } from "@/components/ui/color-picker";
import {
  WIDGET_STYLE_DEFAULTS,
  WIDGET_STYLE_LIMITS,
  googleFontHref,
  resolveWidgetStyle,
} from "@/lib/widget-style";
import { cn } from "@/lib/utils";

/**
 * The SETUP Style section (§4.7 of the reference map): Colors, launcher
 * design (icon/focus ring/close icon), mobile visibility, launcher size and
 * position, typography and the default window size. Everything lives in one
 * draft `WidgetStyle` object and one Save, mirroring how the section is one
 * fact about the Assistant; `resolveWidgetStyle` supplies the effective
 * values, so what the previews here show is what the widget will render.
 */

const DEFAULT_DRAFT: WidgetStyle = {};

/** Curated Google-font list (the shipped font first as the no-op choice). */
const FONT_FAMILIES = [
  "",
  "Inter",
  "Roboto",
  "Open Sans",
  "Lato",
  "Montserrat",
  "Poppins",
  "Nunito",
  "Source Sans 3",
  "IBM Plex Sans",
  "Work Sans",
  "DM Sans",
  "Merriweather",
  "Lora",
];

const FONT_SIZES = [12, 13, 14, 15, 16, 18];

const CORNERS: Array<{ value: WidgetCorner; label: string }> = [
  { value: "bottom-right", label: "Bottom Right" },
  { value: "bottom-left", label: "Bottom Left" },
  { value: "top-right", label: "Top Right" },
  { value: "top-left", label: "Top Left" },
];

export function StyleForm({
  assistant,
  canEdit,
}: {
  assistant: Assistant;
  canEdit: boolean;
}) {
  const saved = React.useMemo<WidgetStyle>(
    () => assistant.style ?? DEFAULT_DRAFT,
    [assistant.style]
  );
  const [draft, setDraft] = React.useState<WidgetStyle>(saved);
  const [isPending, startTransition] = React.useTransition();

  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  const resolved = resolveWidgetStyle(draft);

  const patch = (next: Partial<WidgetStyle>) =>
    setDraft((current) => {
      const merged = { ...current, ...next };
      // Drop cleared keys so the stored JSON stays "absent = default".
      for (const key of Object.keys(merged) as Array<keyof WidgetStyle>) {
        if (merged[key] === undefined || merged[key] === "")
          delete merged[key];
      }
      return merged;
    });

  function save() {
    startTransition(async () => {
      await updateAssistantAction(assistant.id, { style: draft });
      toast.success("Widget style saved, publish to make it live");
    });
  }

  // Load the picked Google font so the typography preview shows it for real.
  const fontHref = googleFontHref(draft.fontFamily ?? "");

  return (
    <div className="flex flex-col gap-8">
      {fontHref ? <link rel="stylesheet" href={fontHref} /> : null}

      {/* ── Colors ─────────────────────────────────────────────────────── */}
      <section>
        <SectionHeading
          title="Colors"
          description="Customize the colors of your chat widget's key elements."
        />
        <div className="mt-3 grid gap-4 md:grid-cols-2">
          <ColorCard
            label="Header"
            description="Background color of the chat window's top bar."
            value={draft.headerColor ?? ""}
            fallback="#F9FAFB"
            canEdit={canEdit}
            onChange={(hex) => patch({ headerColor: hex })}
            onReset={() => patch({ headerColor: undefined })}
          />
          <ColorCard
            label="Text bubble"
            description="Bubble color for messages sent by the user."
            value={draft.bubbleColor ?? ""}
            fallback={resolved.brandColor}
            canEdit={canEdit}
            onChange={(hex) => patch({ bubbleColor: hex })}
            onReset={() => patch({ bubbleColor: undefined })}
          />
          <ColorCard
            label="Buttons"
            description="Color applied to FAQ and action buttons throughout the chat."
            value={draft.buttonColor ?? ""}
            fallback={resolved.brandColor}
            canEdit={canEdit}
            onChange={(hex) => patch({ buttonColor: hex })}
            onReset={() => patch({ buttonColor: undefined })}
          />
        </div>
      </section>

      <Separator />

      {/* ── Launch button design ───────────────────────────────────────── */}
      <section>
        <SectionHeading
          title="Launch button design"
          description="Displayed on the launch button."
        />
        <IconUploadCard
          canEdit={canEdit}
          icon={draft.launcherIcon ?? null}
          onChange={(dataUrl) => patch({ launcherIcon: dataUrl ?? undefined })}
          preview={
            <LauncherPreview
              color={resolved.buttonColor}
              size={Math.min(resolved.buttonSize, 72)}
              radius={resolved.buttonRadius}
              icon={draft.launcherIcon ?? null}
            >
              <MessageCircle className="size-1/2" />
            </LauncherPreview>
          }
        />
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <ColorCard
            label="Launch button focus ring"
            description="Outline color shown around the launcher button when focused via keyboard."
            value={draft.focusRingColor ?? ""}
            fallback={resolved.brandColor}
            canEdit={canEdit}
            onChange={(hex) => patch({ focusRingColor: hex })}
            onReset={() => patch({ focusRingColor: undefined })}
          />
        </div>
      </section>

      <Separator />

      {/* ── Close icon design ──────────────────────────────────────────── */}
      <section>
        <SectionHeading
          title="Close icon design"
          description="Displayed when the chat window is open."
        />
        <IconUploadCard
          canEdit={canEdit}
          icon={draft.closeIcon ?? null}
          onChange={(dataUrl) => patch({ closeIcon: dataUrl ?? undefined })}
          preview={
            <LauncherPreview
              color={resolved.buttonColor}
              size={Math.min(resolved.buttonSize, 72)}
              radius={resolved.buttonRadius}
              icon={draft.closeIcon ?? null}
            >
              <X className="size-1/2" />
            </LauncherPreview>
          }
        />
      </section>

      <Separator />

      {/* ── Mobile ─────────────────────────────────────────────────────── */}
      <section>
        <SectionHeading
          title="Mobile"
          description="Show launch button on small screens."
        />
        <Card size="sm" className="mt-3 flex-row items-center justify-between gap-4 p-4">
          <span className="text-sm">Show launch button on mobile screen sizes</span>
          <Switch
            checked={resolved.showOnMobile}
            disabled={!canEdit}
            onCheckedChange={(checked) =>
              patch({ showOnMobile: checked ? undefined : false })
            }
          />
        </Card>
      </section>

      <Separator />

      {/* ── Button size ────────────────────────────────────────────────── */}
      <section>
        <SectionHeading title="Button size" description="Customize button sizes." />
        <div className="mt-3 grid gap-4 md:grid-cols-2">
          <PxField
            label="Button size"
            value={draft.buttonSize}
            placeholder={WIDGET_STYLE_DEFAULTS.buttonSize}
            limits={WIDGET_STYLE_LIMITS.buttonSize}
            canEdit={canEdit}
            onChange={(n) => patch({ buttonSize: n })}
          />
          <PxField
            label="Button radius"
            value={draft.buttonRadius}
            placeholder={WIDGET_STYLE_DEFAULTS.buttonRadius}
            limits={WIDGET_STYLE_LIMITS.buttonRadius}
            canEdit={canEdit}
            onChange={(n) => patch({ buttonRadius: n })}
          />
        </div>
      </section>

      {/* ── Button position ────────────────────────────────────────────── */}
      <section>
        <SectionHeading
          title="Button position"
          description="Customize button position."
        />
        <div className="mt-3 grid gap-4 md:grid-cols-2">
          <PxField
            label="Bottom Padding"
            value={draft.paddingBottom}
            placeholder={WIDGET_STYLE_DEFAULTS.paddingBottom}
            limits={WIDGET_STYLE_LIMITS.padding}
            canEdit={canEdit}
            onChange={(n) => patch({ paddingBottom: n })}
          />
          <PxField
            label="Right Padding"
            value={draft.paddingRight}
            placeholder={WIDGET_STYLE_DEFAULTS.paddingRight}
            limits={WIDGET_STYLE_LIMITS.padding}
            canEdit={canEdit}
            onChange={(n) => patch({ paddingRight: n })}
          />
        </div>
        <div
          role="radiogroup"
          aria-label="Launcher corner"
          className="mt-4 grid gap-3 md:grid-cols-2"
        >
          {CORNERS.map((corner) => {
            const selected = resolved.corner === corner.value;
            return (
              <button
                key={corner.value}
                type="button"
                role="radio"
                aria-checked={selected}
                disabled={!canEdit}
                onClick={() =>
                  patch({
                    corner: corner.value,
                    // Keep the legacy field coherent for pre-corner readers.
                    position: corner.value.endsWith("left") ? "left" : "right",
                  })
                }
                className={cn(
                  "bg-muted/50 flex items-center gap-3 rounded-lg border px-4 py-3 text-left text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-60",
                  selected
                    ? "border-ring ring-ring/30 ring-2"
                    : "hover:bg-muted border-transparent"
                )}
              >
                <span
                  className={cn(
                    "flex size-4 shrink-0 items-center justify-center rounded-full border-2",
                    selected ? "border-primary" : "border-muted-foreground/50"
                  )}
                >
                  {selected ? (
                    <span className="bg-primary size-2 rounded-full" />
                  ) : null}
                </span>
                {corner.label}
              </button>
            );
          })}
        </div>
      </section>

      <Separator />

      {/* ── Typography ─────────────────────────────────────────────────── */}
      <section>
        <SectionHeading
          title="Typography/Fonts"
          description="Choose a Google font to use on your assistant."
        />
        <div className="mt-3 space-y-4">
          <div className="space-y-2">
            <Label>Font family</Label>
            <Select
              value={draft.fontFamily ?? ""}
              onValueChange={(value) =>
                patch({ fontFamily: (value as string) || undefined })
              }
              disabled={!canEdit}
            >
              <SelectTrigger size="sm" className="max-w-md">
                <SelectValue>
                  {(v: string) => v || "Default (inherit)"}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {FONT_FAMILIES.map((family) => (
                  <SelectItem key={family || "default"} value={family}>
                    {family || "Default (inherit)"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Preview</Label>
            <Card
              size="sm"
              className="gap-1 p-4"
              style={{
                fontFamily: draft.fontFamily
                  ? `"${draft.fontFamily}", sans-serif`
                  : undefined,
                fontSize: resolved.fontSize,
              }}
            >
              <p className="font-semibold">This is title text</p>
              <p className="text-muted-foreground">This is message body text.</p>
            </Card>
          </div>
          <div className="space-y-2">
            <Label>Font size</Label>
            <Select
              value={String(resolved.fontSize)}
              onValueChange={(value) => {
                const n = Number(value);
                patch({
                  fontSize:
                    n === WIDGET_STYLE_DEFAULTS.fontSize ? undefined : n,
                });
              }}
              disabled={!canEdit}
            >
              <SelectTrigger size="sm" className="max-w-md">
                <SelectValue>
                  {(v: string) =>
                    Number(v) === WIDGET_STYLE_DEFAULTS.fontSize
                      ? `${v}px (default)`
                      : `${v}px`
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {FONT_SIZES.map((size) => (
                  <SelectItem key={size} value={String(size)}>
                    {size === WIDGET_STYLE_DEFAULTS.fontSize
                      ? `${size}px (default)`
                      : `${size}px`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </section>

      <Separator />

      {/* ── Window size ────────────────────────────────────────────────── */}
      <section>
        <SectionHeading
          title="Default assistant window size"
          description="Adjust the default window size."
        />
        <div className="mt-3 grid gap-4 md:grid-cols-2">
          <PxField
            label="Window width"
            value={draft.windowWidth}
            placeholder={WIDGET_STYLE_DEFAULTS.windowWidth}
            limits={WIDGET_STYLE_LIMITS.windowWidth}
            canEdit={canEdit}
            onChange={(n) => patch({ windowWidth: n })}
          />
          <PxField
            label="Window height"
            value={draft.windowHeight}
            placeholder={WIDGET_STYLE_DEFAULTS.windowHeight}
            limits={WIDGET_STYLE_LIMITS.windowHeight}
            canEdit={canEdit}
            onChange={(n) => patch({ windowHeight: n })}
          />
        </div>
      </section>

      <div className="flex justify-end">
        <Button onClick={save} disabled={isPending || !dirty || !canEdit}>
          Save
        </Button>
      </div>
    </div>
  );
}

function SectionHeading({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div>
      <h2 className="text-sm font-semibold">{title}</h2>
      <p className="text-muted-foreground mt-0.5 text-sm">{description}</p>
    </div>
  );
}

/**
 * One color row in the reference's shape: `#` prefix + hex text + swatch,
 * an edit button opening the full picker, and a reset that clears the
 * override back to its fallback.
 */
function ColorCard({
  label,
  description,
  value,
  fallback,
  canEdit,
  onChange,
  onReset,
}: {
  label: string;
  description: string;
  /** The stored override; empty = fallback in effect. */
  value: string;
  fallback: string;
  canEdit: boolean;
  onChange: (hex: string) => void;
  onReset: () => void;
}) {
  const effective = value || fallback;
  // Controlled so the swatch inside the hex box can open the same picker the
  // pencil does (one Popover, two ways in).
  const [pickerOpen, setPickerOpen] = React.useState(false);
  const [hexDraft, setHexDraft] = React.useState(
    effective.replace(/^#/, "").toUpperCase()
  );
  const [lastEffective, setLastEffective] = React.useState(effective);
  if (effective !== lastEffective) {
    setLastEffective(effective);
    setHexDraft(effective.replace(/^#/, "").toUpperCase());
  }

  return (
    <Card size="sm" className="gap-3 p-4">
      <div>
        <p className="text-sm font-medium">{label}</p>
        <p className="text-muted-foreground mt-0.5 text-sm">{description}</p>
      </div>
      <div className="flex items-center gap-2">
        <div className="flex h-9 flex-1 items-center overflow-hidden rounded-md border">
          <span className="text-muted-foreground bg-muted/60 flex h-full items-center border-r px-2.5 text-sm">
            #
          </span>
          <Input
            aria-label={`${label} color`}
            value={hexDraft}
            disabled={!canEdit}
            spellCheck={false}
            className="h-full min-w-0 flex-1 rounded-none border-0 bg-transparent font-mono text-xs uppercase shadow-none focus-visible:ring-0"
            onChange={(e) => {
              const raw = e.target.value;
              setHexDraft(raw.toUpperCase());
              if (/^[0-9a-fA-F]{6}$/.test(raw.trim())) {
                onChange(`#${raw.trim().toUpperCase()}`);
              }
            }}
            onBlur={() => setHexDraft(effective.replace(/^#/, "").toUpperCase())}
          />
          <button
            type="button"
            disabled={!canEdit}
            aria-label={`Edit ${label} color`}
            onClick={() => setPickerOpen(true)}
            className="mx-2 shrink-0 self-center rounded-full disabled:cursor-not-allowed"
          >
            <span
              className="border-border/60 block size-4 rounded-full border transition-transform hover:scale-110"
              style={{ backgroundColor: effective }}
              aria-hidden
            />
          </button>
        </div>
        <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
          <PopoverTrigger
            disabled={!canEdit}
            aria-label={`Edit ${label} color`}
            className="hover:bg-muted flex size-9 shrink-0 items-center justify-center rounded-md border disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Pencil className="size-4" />
          </PopoverTrigger>
          <PopoverContent align="end" className="w-auto p-3">
            <ColorPicker alpha={false} value={effective} onChange={onChange} />
          </PopoverContent>
        </Popover>
        <Button
          type="button"
          variant="outline"
          size="icon-lg"
          aria-label={`Reset ${label} color`}
          disabled={!canEdit || !value}
          onClick={onReset}
        >
          <RotateCcw className="size-4" />
        </Button>
      </div>
    </Card>
  );
}

function PxField({
  label,
  value,
  placeholder,
  limits,
  canEdit,
  onChange,
}: {
  label: string;
  value: number | undefined;
  placeholder: number;
  limits: { min: number; max: number };
  canEdit: boolean;
  onChange: (value: number | undefined) => void;
}) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <div className="flex items-center gap-2">
        <Input
          type="number"
          inputMode="numeric"
          min={limits.min}
          max={limits.max}
          value={value ?? ""}
          placeholder={String(placeholder)}
          disabled={!canEdit}
          onChange={(e) => {
            const raw = e.target.value;
            if (raw === "") return onChange(undefined);
            const n = Number(raw);
            if (Number.isFinite(n)) onChange(n);
          }}
          onBlur={() => {
            if (value === undefined) return;
            const clamped = Math.min(limits.max, Math.max(limits.min, value));
            if (clamped !== value) onChange(clamped);
          }}
        />
        <span className="text-muted-foreground rounded-md border px-2.5 py-2 text-xs">
          px
        </span>
      </div>
    </div>
  );
}

/**
 * Upload half + live preview half, the reference's two-pane card. Reads the
 * file as a data: URL after checking type, byte size and pixel dimensions;
 * the URL rides `assistants.style` into the Publication snapshot, hence the
 * caps in {@link WIDGET_STYLE_LIMITS}.
 */
function IconUploadCard({
  canEdit,
  icon,
  onChange,
  preview,
}: {
  canEdit: boolean;
  icon: string | null;
  onChange: (dataUrl: string | null) => void;
  preview: React.ReactNode;
}) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = React.useState(false);

  async function readFile(file: File) {
    const ok = /^image\/(svg\+xml|png|jpeg|x-icon|vnd\.microsoft\.icon)$/.test(
      file.type
    );
    if (!ok) {
      toast.error("Use an SVG, PNG, JPEG or ICO file");
      return;
    }
    if (file.size > WIDGET_STYLE_LIMITS.iconBytes) {
      toast.error("Icon too large, keep it under 64KB");
      return;
    }
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
    // Dimension gate (skipped for SVG, which scales losslessly anyway).
    if (!file.type.includes("svg")) {
      const okSize = await new Promise<boolean>((resolve) => {
        const img = new Image();
        img.onload = () =>
          resolve(
            img.width <= WIDGET_STYLE_LIMITS.iconPx &&
              img.height <= WIDGET_STYLE_LIMITS.iconPx
          );
        img.onerror = () => resolve(false);
        img.src = dataUrl;
      });
      if (!okSize) {
        toast.error(
          `Icon must be at most ${WIDGET_STYLE_LIMITS.iconPx}×${WIDGET_STYLE_LIMITS.iconPx}px`
        );
        return;
      }
    }
    onChange(dataUrl);
  }

  return (
    <Card size="sm" className="mt-3 flex-row items-stretch gap-0 p-0">
      <div
        className={cn(
          "flex flex-1 flex-col items-center justify-center gap-2 rounded-l-xl p-6 text-center",
          dragging && "bg-muted/60"
        )}
        onDragOver={(e) => {
          e.preventDefault();
          if (canEdit) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (!canEdit) return;
          const file = e.dataTransfer.files?.[0];
          if (file) void readFile(file);
        }}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".svg,.png,.jpg,.jpeg,.ico,image/svg+xml,image/png,image/jpeg,image/x-icon"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void readFile(file);
            e.target.value = "";
          }}
        />
        <Button
          type="button"
          variant="outline"
          size="icon-lg"
          aria-label="Upload icon"
          disabled={!canEdit}
          onClick={() => inputRef.current?.click()}
        >
          <UploadCloud className="size-4" />
        </Button>
        <p className="text-sm">
          <button
            type="button"
            disabled={!canEdit}
            onClick={() => inputRef.current?.click()}
            className="text-primary font-medium underline-offset-2 hover:underline disabled:cursor-not-allowed"
          >
            Click to upload
          </button>{" "}
          or drag and drop
        </p>
        <p className="text-muted-foreground text-xs">
          SVG, PNG, JPEG or ICO (max. {WIDGET_STYLE_LIMITS.iconPx}×
          {WIDGET_STYLE_LIMITS.iconPx}px)
        </p>
        {icon ? (
          <Button
            type="button"
            variant="ghost"
            size="xs"
            disabled={!canEdit}
            onClick={() => onChange(null)}
          >
            Remove custom icon
          </Button>
        ) : null}
      </div>
      <div className="flex w-48 flex-col items-center justify-center gap-3 border-l p-6">
        <p className="text-sm font-medium">Preview</p>
        {preview}
      </div>
    </Card>
  );
}

/** The launcher disc as the widget draws it: color, size, radius, icon. */
function LauncherPreview({
  color,
  size,
  radius,
  icon,
  children,
}: {
  color: string;
  size: number;
  radius: number;
  icon: string | null;
  children: React.ReactNode;
}) {
  return (
    <span
      className="flex items-center justify-center text-white shadow-md"
      style={{
        backgroundColor: color,
        width: size,
        height: size,
        // Radius is px, capped at half the size (100 on a 56px disc = circle).
        borderRadius: Math.min(radius, size / 2),
      }}
    >
      {icon ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={icon} alt="" className="size-1/2 object-contain" />
      ) : (
        children
      )}
    </span>
  );
}
