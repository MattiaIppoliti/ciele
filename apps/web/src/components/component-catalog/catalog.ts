/** Atomic presentation contracts and complete feature blocks used by Ciele. */
export const CATALOG_GROUPS: readonly string[] = [
  "Foundations", "Forms", "Navigation", "Surfaces", "Data display", "AI & chat", "Motion", "Overview", "Analytics",
];

export interface ComponentFamily {
  slug: string;
  kind: "component" | "block";
  title: string;
  description: string;
  group: string;
  preview: "primitive" | "platform" | "block";
  variants: string[];
  sources: string[];
  usage: string;
  notes?: string;
}

export const COMPONENT_FAMILIES: readonly ComponentFamily[] = [
  {
    slug: "arc-picker", kind: "component", title: "Arc picker",
    description: "One selection control arranged along a draggable arc.",
    group: "Forms", preview: "primitive", variants: ["Selection", "Keyboard", "Disabled option"],
    sources: ["apps/web/src/components/motion/arc-picker.tsx"],
    usage: `import { ArcPicker } from "@/components/motion/arc-picker";
export default function Example() { return <ArcPicker defaultValue="support" options={[{ value: "support", label: "Support" }, { value: "research", label: "Research" }]} />; }`,
  },
  {
    slug: "morph-text", kind: "component", title: "Morph text",
    description: "A changing text label with a static reduced-motion fallback.",
    group: "Motion", preview: "primitive", variants: ["Changing label", "Reduced motion"],
    sources: ["apps/web/src/components/motion/morph-text.tsx"],
    usage: `import { MorphText } from "@/components/motion/morph-text";
export default function Example() { return <MorphText text="Support assistant" />; }`,
  },
  {
    slug: "insights-stat-card", kind: "component", title: "Insights stat card",
    description: "One dashboard statistic, including numeric, text and unavailable values.",
    group: "Data display", preview: "platform", variants: ["Numeric", "Text", "Unavailable"],
    sources: ["apps/web/src/components/insights/insights-stat-card.tsx", "apps/web/src/components/insights/analytics-card.tsx", "apps/web/src/components/charts/arc/metric-card/metric-card.tsx"],
    usage: `import { InsightsStatCard } from "@/components/insights/insights-stat-card";
export default function Example() { return <InsightsStatCard title="Resolution rate" value="82.7%" numericValue={82.7} suffix="%" decimals={1} />; }`,
  },
  {
    slug: "buttons",
    kind: "component",
    title: "Button",
    description: "A shared action control with visual variants, sizes and pending states.",
    group: "Foundations",
    preview: "primitive",
    variants: ["Default", "Outline", "Secondary", "Ghost", "Destructive", "Sizes", "Motion variants"],
    sources: ["packages/ui/src/button.tsx", "apps/web/src/components/motion/button/base.tsx", "apps/web/src/components/settings/pending-submit-button.tsx"],
    usage: `"use client";

import { Button } from "@agent-hub/ui";

export default function Example() {
  return (
    <>
      <Button>Save changes</Button>
      <Button variant="outline">Cancel</Button>
      <Button variant="destructive">Delete</Button>
    </>
  );
}`,
    notes: "The console uses the shared Button. PendingSubmitButton adds a form pending state to the same control. Icon actions need an aria-label.",
  },
  {
    slug: "inputs",
    kind: "component",
    title: "Input",
    description: "A single-line native text field with focus, invalid and disabled states.",
    group: "Forms",
    preview: "primitive",
    variants: ["Text", "Disabled", "Invalid"],
    sources: ["packages/ui/src/input.tsx"],
    usage: `"use client";

import { Input } from "@agent-hub/ui";

export default function Example() {
  return (
    <Input aria-label="Assistant name" placeholder="My assistant" />
  );
}`,
  },
  {
    slug: "textareas",
    kind: "component",
    title: "Textareas",
    description: "Multiline text fields for instructions, descriptions, messages and Markdown.",
    group: "Forms",
    preview: "primitive",
    variants: ["Default", "Disabled", "Invalid", "Resizable"],
    sources: ["apps/web/src/components/ui/textarea.tsx"],
    usage: `"use client";

import { Textarea } from "@/components/ui/textarea";

export default function Example() {
  return (
    <>
      <Textarea aria-label="Instructions" rows={4} placeholder="Describe how the assistant should answer…" />
    </>
  );
}`,
    notes: "General settings and the Skill editor currently use this textarea for their text content.",
  },
  {
    slug: "labels",
    kind: "component",
    title: "Label",
    description: "A semantic label associated with one form control.",
    group: "Foundations",
    preview: "primitive",
    variants: ["Default", "Required", "Disabled control"],
    sources: ["packages/ui/src/label.tsx"],
    usage: `"use client";

import { Input, Label } from "@agent-hub/ui";

export default function Example() {
  return (
    <>
      <Label htmlFor="name">Name</Label>
      <Input id="name" placeholder="My assistant" />
    </>
  );
}`,
  },
  {
    slug: "switches",
    kind: "component",
    title: "Switches",
    description: "One binary-setting control with shared geometry, small sizing and compatibility import paths.",
    group: "Forms",
    preview: "primitive",
    variants: ["Default", "Small", "Checked", "Unchecked", "Disabled", "Static"],
    sources: ["apps/web/src/components/ui/motion-switch.tsx", "apps/web/src/components/ui/switch.tsx"],
    usage: `"use client";

import { Switch } from "@/components/ui/motion-switch";

export default function Example() {
  return (
    <>
      <Switch aria-label="Suggested questions" checked={true} onCheckedChange={() => {}} />
    </>
  );
}`,
    notes: "ui/switch re-exports the same motion-switch implementation. Both import paths share sizes, focus, reduced motion and press feedback.",
  },
  {
    slug: "checkboxes",
    kind: "component",
    title: "Checkboxes",
    description: "Independent selections and indeterminate controls for tables and settings.",
    group: "Forms",
    preview: "primitive",
    variants: ["Unchecked", "Checked", "Indeterminate", "Disabled"],
    sources: ["apps/web/src/components/ui/checkbox.tsx"],
    usage: `"use client";

import { Checkbox } from "@/components/ui/checkbox";

export default function Example() {
  return (
    <>
      <Checkbox aria-label="Include archived items" defaultChecked />
      <Checkbox aria-label="Select all rows" indeterminate />
    </>
  );
}`,
  },
  {
    slug: "radio-groups",
    kind: "component",
    title: "Radio groups",
    description: "One choice from a labelled set, including hints and unavailable options.",
    group: "Forms",
    preview: "primitive",
    variants: ["Selected", "Unselected", "Option hint", "Disabled option"],
    sources: ["apps/web/src/components/ui/radio-group.tsx"],
    usage: `"use client";

import { useState } from "react";
import { RadioGroup } from "@/components/ui/radio-group";

export default function Example() {
  const [format, setFormat] = useState("csv");

  return (
    <>
      <RadioGroup value={format} onValueChange={setFormat} aria-label="Export format"
        options={[{ value: "csv", label: "CSV" }, { value: "json", label: "JSON" }]} />
    </>
  );
}`,
  },
  {
    slug: "selects",
    kind: "component",
    title: "Selects",
    description: "Single and multiple selection menus, grouped options and supporting descriptions.",
    group: "Forms",
    preview: "primitive",
    variants: ["Single", "Multiple", "Disabled"],
    sources: ["apps/web/src/components/ui/select.tsx", "apps/web/src/components/motion/select.tsx"],
    usage: `"use client";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export default function Example() {
  return (
    <>
      <Select value="weekly" onValueChange={() => {}}>
        <SelectTrigger><SelectValue placeholder="Frequency" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="weekly">Weekly</SelectItem>
          <SelectItem value="monthly">Monthly</SelectItem>
        </SelectContent>
      </Select>
    </>
  );
}`,
    notes: "The console import path delegates to the motion Select. Keep SelectTrigger and SelectContent inside their Select root. The same API supports groups, descriptions and disabled options.",
  },
  {
    slug: "filters",
    kind: "component",
    title: "Filters",
    description: "Compact labelled selectors for list, conversation and analytics filters.",
    group: "Forms",
    preview: "primitive",
    variants: ["Labelled filter", "Select options", "Custom value / datalist"],
    sources: ["apps/web/src/components/ui/filter-select.tsx"],
    usage: `"use client";

import { FilterSelect } from "@/components/ui/filter-select";

export default function Example() {
  return (
    <>
      <FilterSelect label="Status" value="" onChange={() => {}} placeholder="All statuses"
        options={[{ value: "ready", label: "Ready" }, { value: "processing", label: "Processing" }]} />
    </>
  );
}`,
  },
  {
    slug: "tabs",
    kind: "component",
    title: "Tabs",
    description: "Segmented navigation with a sliding active pill, links and animated content panels.",
    group: "Navigation",
    preview: "primitive",
    variants: ["Segmented tabs", "Controlled tabs", "Content panels", "Disabled tab"],
    sources: ["apps/web/src/components/motion/tabs.tsx", "apps/web/src/components/ui/tabs.tsx", "apps/web/src/components/motion/sliding-panel.tsx"],
    usage: `"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/motion/tabs";

export default function Example() {
  return (
    <>
      <Tabs defaultValue="overview">
        <TabsList><TabsTrigger value="overview">Overview</TabsTrigger><TabsTrigger value="activity">Activity</TabsTrigger></TabsList>
        <TabsContent value="overview">Overview content</TabsContent>
        <TabsContent value="activity">Activity content</TabsContent>
      </Tabs>
    </>
  );
}`,
    notes: "ui/tabs re-exports the same motion implementation. Tab triggers and content require their parent Tabs context. Route navigation uses link tabs; SlidingTabPanel is the matching content-transition integration.",
  },
  {
    slug: "badges",
    kind: "component",
    title: "Badge",
    description: "Compact labels in neutral variants and six semantic tones.",
    group: "Data display",
    preview: "primitive",
    variants: ["Default", "Secondary", "Outline", "Destructive", "Semantic tones"],
    sources: ["packages/ui/src/badge.tsx"],
    usage: `"use client";

import { Badge } from "@agent-hub/ui";

export default function Example() {
  return (
    <Badge tone="green">Ready</Badge>
  );
}`,
  },
  {
    slug: "cards",
    kind: "component",
    title: "Card",
    description: "One content surface with matching header, body and footer parts.",
    group: "Surfaces",
    preview: "primitive",
    variants: ["Default", "Compact", "Header / body / footer"],
    sources: ["packages/ui/src/card.tsx"],
    usage: `"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@agent-hub/ui";

export default function Example() {
  return (
    <>
      <Card><CardHeader><CardTitle>Knowledge</CardTitle></CardHeader><CardContent>Everything your assistant can use.</CardContent></Card>
    </>
  );
}`,
  },
  {
    slug: "dialogs",
    kind: "component",
    title: "Dialog",
    description: "A modal surface with accessible titles, descriptions and action slots.",
    group: "Surfaces",
    preview: "primitive",
    variants: ["Default", "Header / footer", "Controlled", "Dismissible"],
    sources: ["packages/ui/src/dialog.tsx"],
    usage: `"use client";

import { Button, Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "@agent-hub/ui";

export default function Example() {
  return (
    <>
      <Dialog>
        <DialogTrigger render={<Button />}>Open dialog</DialogTrigger>
        <DialogContent><DialogTitle>Create assistant</DialogTitle><DialogDescription>Give your new assistant a name.</DialogDescription></DialogContent>
      </Dialog>
    </>
  );
}`,
  },
  {
    slug: "popovers",
    kind: "component",
    title: "Popover",
    description: "Anchored content with consistent placement and focus management.",
    group: "Surfaces",
    preview: "primitive",
    variants: ["Default", "Side placement", "Alignment"],
    sources: ["packages/ui/src/popover.tsx"],
    usage: `"use client";

import { Button, Popover, PopoverContent, PopoverTrigger } from "@agent-hub/ui";

export default function Example() {
  return (
    <>
      <Popover><PopoverTrigger render={<Button variant="outline" />}>Details</PopoverTrigger><PopoverContent>Additional information.</PopoverContent></Popover>
    </>
  );
}`,
  },
  {
    slug: "menus",
    kind: "component",
    title: "Dropdown menu",
    description: "A trigger and action menu with groups, separators and selected items.",
    group: "Navigation",
    preview: "primitive",
    variants: ["Actions", "Grouped actions", "Disabled item"],
    sources: ["apps/web/src/components/ui/dropdown-menu.tsx"],
    usage: `"use client";

import { Button } from "@agent-hub/ui";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

export default function Example() {
  return (
    <>
      <DropdownMenu><DropdownMenuTrigger render={<Button variant="outline" />}>Options</DropdownMenuTrigger><DropdownMenuContent><DropdownMenuItem>Duplicate</DropdownMenuItem><DropdownMenuItem>Archive</DropdownMenuItem></DropdownMenuContent></DropdownMenu>
    </>
  );
}`,
  },
  {
    slug: "tooltips",
    kind: "component",
    title: "Tooltip",
    description: "A short explanation connected to an interactive control.",
    group: "Surfaces",
    preview: "primitive",
    variants: ["Hint", "Four placements"],
    sources: ["packages/ui/src/hint.tsx", "packages/ui/src/tooltip.tsx"],
    usage: `"use client";

import { Button, Hint, TooltipProvider } from "@agent-hub/ui";

export default function Example() {
  return (
    <>
      <TooltipProvider><Hint label="Refresh the preview"><Button variant="outline">Refresh</Button></Hint></TooltipProvider>
    </>
  );
}`,
    notes: "Hint is the public shared component; TooltipProvider supplies its context. The raw tooltip parts are internal implementation.",
  },
  {
    slug: "accordions",
    kind: "component",
    title: "Accordions",
    description: "Expandable question-and-answer rows with animated disclosure content.",
    group: "Surfaces",
    preview: "primitive",
    variants: ["BouncyAccordion", "Closed / expanded", "Rich content"],
    sources: ["apps/web/src/components/motion/bouncy-accordion.tsx"],
    usage: `"use client";

import { BouncyAccordion } from "@/components/motion/bouncy-accordion";

export default function Example() {
  return (
    <>
      <BouncyAccordion items={[{ id: "hosting", title: "Can I self-host Ciele?", description: "Yes. Run the platform on your own infrastructure." }]} />
    </>
  );
}`,
    notes: "Used by the pricing and security pages.",
  },
  {
    slug: "drawers",
    kind: "component",
    title: "Sliding panel",
    description: "A direction-aware transition between panels and route content.",
    group: "Surfaces",
    preview: "primitive",
    variants: ["Forward", "Backward", "Reduced motion"],
    sources: ["apps/web/src/components/motion/sliding-panel.tsx", "apps/web/src/components/motion/route-sliding-panel.tsx"],
    usage: `"use client";

import { SlidingPanel } from "@/components/motion/sliding-panel";

export default function Example() {
  return (
    <>
      <SlidingPanel activeKey="details" direction={1}><p>Details for the selected item.</p></SlidingPanel>
    </>
  );
}`,
    notes: "SlidingTabPanel and RouteSlidingPanel compose the same transition for tabs and routes.",
  },
  {
    slug: "bottom-sheets",
    kind: "component",
    title: "Bottom sheets",
    description: "A draggable mobile surface with viewport snap points and gesture-aware dismissal.",
    group: "Surfaces",
    preview: "primitive",
    variants: ["Multiple snaps", "Drag to dismiss"],
    sources: ["apps/web/src/components/motion/bottom-sheet.tsx"],
    usage: `"use client";

import { useState } from "react";
import { BottomSheet } from "@/components/motion/bottom-sheet";

export default function Example() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <BottomSheet open={open} onOpenChange={setOpen} snapPoints={[0.45, 0.8]} title="Setup guide"><p>Follow these steps.</p></BottomSheet>
    </>
  );
}`,
    notes: "Used by the local terminal setup guide. Snap points are fractions of the viewport height.",
  },
  {
    slug: "tables",
    kind: "block",
    title: "Data table",
    description: "A complete operational list with sorting, filtering, column resizing, selection, row actions and pagination.",
    group: "Data display",
    preview: "primitive",
    variants: ["TableCard", "Table parts", "Motion Table", "Sortable / filterable headers", "Resizable columns", "Row selection / bulk bar", "Row actions", "Pagination", "Open cell"],
    sources: ["apps/web/src/components/ui/table.tsx", "apps/web/src/components/ui/table-column-header.tsx", "apps/web/src/components/ui/table-columns.tsx", "apps/web/src/components/ui/table-selection.tsx", "apps/web/src/components/ui/table-menu.tsx", "apps/web/src/components/ui/table-pagination.tsx", "apps/web/src/components/ui/table-open-cell.tsx"],
    usage: `"use client";

import { Table, TableBody, TableCard, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export default function Example() {
  return (
    <>
      <TableCard><Table><TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Status</TableHead></TableRow></TableHeader><TableBody><TableRow><TableCell>Product guide</TableCell><TableCell>Ready</TableCell></TableRow></TableBody></Table></TableCard>
    </>
  );
}`,
    notes: "The native table family is used for knowledge and operational lists. The generic motion Table is also used for members, API keys and platform analytics. Resize hooks need stable column IDs.",
  },
  {
    slug: "calendars",
    kind: "component",
    title: "Calendar",
    description: "A shared date-selection contract for single dates and ranges.",
    group: "Forms",
    preview: "primitive",
    variants: ["Single date", "Date range", "Disabled dates", "Shared wrapper"],
    sources: ["packages/ui/src/calendar.tsx", "apps/web/src/components/ui/calendar.tsx"],
    usage: `"use client";

import { Calendar } from "@/components/ui/calendar";

export default function Example() {
  return (
    <>
      <Calendar value="2026-10-04" onSelect={() => {}} />
    </>
  );
}`,
    notes: "The app wrappers format the shared calendar value as an ISO date string or range.",
  },
  {
    slug: "color-pickers",
    kind: "component",
    title: "Colour pickers",
    description: "Colour swatches, a picker surface and editable hex values for widget styling.",
    group: "Forms",
    preview: "primitive",
    variants: ["Swatch", "Picker", "Hex input"],
    sources: ["apps/web/src/components/ui/color-picker.tsx"],
    usage: `"use client";

import { useState } from "react";
import { ColorPicker } from "@/components/ui/color-picker";

export default function Example() {
  const [color, setColor] = useState("#5e6ad2");

  return (
    <>
      <ColorPicker value={color} onChange={setColor} />
    </>
  );
}`,
  },
  {
    slug: "file-upload",
    kind: "component",
    title: "File upload",
    description: "Drop files, review the queue and show progress, completion or retry states.",
    group: "Forms",
    preview: "primitive",
    variants: ["Drop zone", "Queued", "Uploading", "Success", "Error / retry", "File type icons"],
    sources: ["apps/web/src/components/ui/file-upload.tsx"],
    usage: `"use client";

import { FileUpload } from "@/components/ui/file-upload";

export default function Example() {
  return (
    <>
      <FileUpload value={[]} onValueChange={() => {}} onFilesAdded={() => {}} onRetry={() => {}}
        accept=".pdf,.docx,.txt" title="Upload files" description="Drop your documents here." />
    </>
  );
}`,
    notes: "This is the upload presentation. The consuming feature owns the actual transfer and updates each item's progress and status.",
  },
  {
    slug: "sortable-lists",
    kind: "component",
    title: "Sortable lists",
    description: "Reorder flow steps and starter buttons with an explicit drag handle.",
    group: "Forms",
    preview: "primitive",
    variants: ["SortableList", "SortableItem", "SortableHandle"],
    sources: ["apps/web/src/components/ui/sortable-list.tsx"],
    usage: `"use client";

import { SortableHandle, SortableItem, SortableList } from "@/components/ui/sortable-list";

export default function Example() {
  return (
    <>
      <SortableList values={["first", "second"]} onReorder={() => {}}>
        <SortableItem value="first"><SortableHandle />First step</SortableItem>
        <SortableItem value="second"><SortableHandle />Second step</SortableItem>
      </SortableList>
    </>
  );
}`,
  },
  {
    slug: "list-inputs",
    kind: "component",
    title: "List inputs",
    description: "A text field that preserves typing while producing a list of values.",
    group: "Forms",
    preview: "primitive",
    variants: ["Default separators", "Custom separator", "Empty / populated"],
    sources: ["apps/web/src/components/ui/list-input.tsx"],
    usage: `"use client";

import { useState } from "react";
import { ListInput } from "@/components/ui/list-input";

export default function Example() {
  const [values, setValues] = useState(["support@example.com"]);

  return (
    <>
      <ListInput values={values} onChange={setValues} aria-label="Recipients" />
    </>
  );
}`,
  },
  {
    slug: "avatars",
    kind: "component",
    title: "Generated avatar",
    description: "A deterministic identity mark with static and animated variants.",
    group: "Foundations",
    preview: "primitive",
    variants: ["Static", "Animated", "Sizes"],
    sources: ["apps/web/src/components/ui/generated-avatar.tsx", "apps/web/src/components/ui/static-avatar.tsx", "apps/web/src/components/ui/animated-avatar.tsx"],
    usage: `"use client";

import { GeneratedAvatar } from "@/components/ui/generated-avatar";

export default function Example() {
  return (
    <GeneratedAvatar seed="ciele" />
  );
}`,
  },
  {
    slug: "icons",
    kind: "component",
    title: "Animated icon",
    description: "A consistent hover animation contract for package and local glyphs.",
    group: "Foundations",
    preview: "primitive",
    variants: ["AnimatedIcon", "AnimatedGlyph", "Static policy", "Local glyphs"],
    sources: ["apps/web/src/components/ui/animated-icon.tsx", "apps/web/src/components/ui/icons/folders.tsx", "apps/web/src/components/ui/icons/mailbox.tsx", "apps/web/src/components/ui/icons/maximize-2.tsx", "apps/web/src/components/ui/icons/message-circle.tsx", "apps/web/src/components/ui/icons/scan-text.tsx", "apps/web/src/components/ui/icons/telescope.tsx", "apps/web/src/components/ui/icons/user-round-cog.tsx", "apps/web/src/components/ui/icons/users-round.tsx", "apps/web/src/components/ui/icons/volume-2.tsx"],
    usage: `"use client";

import { Search } from "lucide-react";
import { AnimatedIcon } from "@/components/ui/animated-icon";

export default function Example() {
  return (
    <>
      <button type="button" aria-label="Search"><AnimatedIcon icon={Search} size={18} /></button>
    </>
  );
}`,
  },
  {
    slug: "empty-states",
    kind: "component",
    title: "Empty states",
    description: "A shared illustrated mark, guidance and an optional action when a list has no content.",
    group: "Data display",
    preview: "primitive",
    variants: ["Default", "Small", "Action", "Arc illustration"],
    sources: ["apps/web/src/components/ui/empty-state.tsx", "apps/web/src/components/arc/empty-state/empty-state.tsx"],
    usage: `"use client";

import { Button } from "@agent-hub/ui";
import { EmptyState } from "@/components/ui/empty-state";

export default function Example() {
  return (
    <>
      <EmptyState title="No documents yet" description="Add a source to start building your knowledge." action={<Button>Add source</Button>} />
    </>
  );
}`,
  },
  {
    slug: "skeletons",
    kind: "component",
    title: "Skeleton",
    description: "Neutral placeholders shaped as text, avatars or cards.",
    group: "Data display",
    preview: "primitive",
    variants: ["Text", "Avatar", "Card"],
    sources: ["packages/ui/src/skeleton.tsx", "apps/web/src/components/route-skeleton.tsx", "apps/web/src/components/knowledge/document-skeleton.tsx", "apps/web/src/components/knowledge/source-documents-skeleton.tsx", "apps/web/src/components/teammates/thread-skeleton.tsx", "apps/web/src/components/insights/dashboard/dashboard-skeleton.tsx"],
    usage: `"use client";

import { Skeleton } from "@agent-hub/ui";

export default function Example() {
  return (
    <>
      <div className="space-y-3"><Skeleton className="h-5 w-40" /><Skeleton className="h-4 w-full" /><Skeleton className="h-4 w-3/4" /></div>
    </>
  );
}`,
    notes: "Route and feature skeletons compose this same placeholder primitive. Their source files are included as integrations.",
  },
  {
    slug: "copy-feedback",
    kind: "component",
    title: "Copy feedback",
    description: "Clipboard acknowledgement that keeps the control stable during copied and failed states.",
    group: "Data display",
    preview: "primitive",
    variants: ["Idle", "Copied", "Clipboard unavailable"],
    sources: ["packages/ui/src/copy-feedback.tsx"],
    usage: `"use client";

import { CopyFeedbackIcon, useCopyFeedback } from "@agent-hub/ui";

export default function Example() {
  const { copyText, isCopied } = useCopyFeedback<string>();

  return (
    <button type="button" aria-label="Copy identifier" onClick={() => copyText("id", "assistant-demo")}><CopyFeedbackIcon copied={isCopied("id")} /></button>
  );
}`,
  },
  {
    slug: "resizable-panels",
    kind: "component",
    title: "Resizable panels",
    description: "Draggable width controls for the sidebar, chat preview and operational detail rails.",
    group: "Surfaces",
    preview: "primitive",
    variants: ["ResizeHandle", "useResizableWidth", "Keyboard resize"],
    sources: ["apps/web/src/components/ui/resizable-panel.tsx", "packages/ui/src/use-resizable-width.ts"],
    usage: `"use client";

import { ResizeHandle, useResizableWidth } from "@/components/ui/resizable-panel";

export default function Example() {
  const panel = useResizableWidth({ defaultWidth: 320, minWidth: 240, maxWidth: 480 });

  return (
    <aside ref={panel.containerRef} style={{ width: panel.width }} className="relative border-l p-4"><ResizeHandle resizing={panel.resizing} onPointerDown={panel.beginResize} value={panel.width} minValue={240} maxValue={480} onValueChange={panel.resizeTo} label="Resize panel" />Panel content</aside>
  );
}`,
    notes: "The shared hook owns drag and keyboard behaviour and supports overdrag collapse thresholds for the shell. The app ResizeHandle paints a handle that sits on the panel border.",
  },
  {
    slug: "text-motion",
    kind: "component",
    title: "Rolling text",
    description: "Changing labels roll in place while static copy keeps its normal typography.",
    group: "Motion",
    preview: "primitive",
    variants: ["Changed value", "Entrance", "Reduced motion"],
    sources: ["apps/web/src/components/motion/roll-in-text.tsx", "apps/web/src/components/home/hero-rolling-word.tsx"],
    usage: `"use client";

import { RollInText } from "@/components/motion/roll-in-text";

export default function Example() {
  return (
    <RollInText text="Changes saved" />
  );
}`,
    notes: "The website headline is an integration of this same rolling-text presentation. RollRow has its own composition page.",
  },
  {
    slug: "loading-motion",
    kind: "component",
    title: "Loading reveal",
    description: "A transition from a placeholder to content once loading completes.",
    group: "Motion",
    preview: "primitive",
    variants: ["Loading", "Ready", "Reduced motion"],
    sources: ["apps/web/src/components/motion/loading-reveal.tsx", "apps/web/src/components/motion/text-field-motion.tsx"],
    usage: `"use client";

import { Skeleton } from "@agent-hub/ui";
import { LoadingReveal } from "@/components/motion/loading-reveal";

export default function Example() {
  return (
    <>
      <LoadingReveal loading={false} placeholder={<Skeleton className="h-24" />}><p>Your content is ready.</p></LoadingReveal>
    </>
  );
}`,
    notes: "TextFieldMotion binds related field feedback at the shell; it has no independently rendered surface.",
  },
  {
    slug: "action-swap",
    kind: "component",
    title: "Action swap",
    description: "A label transitions in place as a task or tool changes state.",
    group: "Motion",
    preview: "primitive",
    variants: ["Text swap", "Custom child content"],
    sources: ["apps/web/src/components/motion/action-swap.tsx"],
    usage: `"use client";

import { ActionSwapText } from "@/components/motion/action-swap";

export default function Example() {
  return (
    <>
      <ActionSwapText value="Completed">Completed</ActionSwapText>
    </>
  );
}`,
    notes: "Used by TodoList and ToolResult. Change value when the displayed action label changes.",
  },
  {
    slug: "tilt-cards",
    kind: "component",
    title: "Tilt card",
    description: "Pointer-responsive depth for an infrequent marketing interaction.",
    group: "Motion",
    preview: "primitive",
    variants: ["Glare", "No glare", "Reduced motion"],
    sources: ["apps/web/src/components/motion/tilt-card.tsx", "apps/web/src/components/motion/tilt-card-motion.tsx"],
    usage: `"use client";

import { TiltCard } from "@/components/motion/tilt-card";

export default function Example() {
  return (
    <>
      <TiltCard><div className="rounded-xl border p-8">Explore Ciele</div></TiltCard>
    </>
  );
}`,
  },
  {
    slug: "grid-beam",
    kind: "component",
    title: "Grid beam",
    description: "An animated grid surface that gives the pricing page its background structure.",
    group: "Motion",
    preview: "primitive",
    variants: ["Grid", "Animated beam", "Reduced motion"],
    sources: ["apps/web/src/components/motion/grid-beam.tsx"],
    usage: `"use client";

import { GridBeam } from "@/components/motion/grid-beam";

export default function Example() {
  return (
    <>
      <GridBeam cols={2} rows={1}><div className="p-6">First cell</div><div className="p-6">Second cell</div></GridBeam>
    </>
  );
}`,
  },
  {
    slug: "preview-rail",
    kind: "component",
    title: "Preview rail",
    description: "A compact rail of selectable previews for sections and messages.",
    group: "Navigation",
    preview: "primitive",
    variants: ["Default preview", "Content slot", "Active item"],
    sources: ["apps/web/src/components/motion/preview-rail.tsx"],
    usage: `"use client";

import { PreviewRail } from "@/components/motion/preview-rail";

export default function Example() {
  return (
    <>
      <PreviewRail items={[{ id: "overview", label: "Overview" }]} activeId="overview" onActiveChange={() => {}} />
    </>
  );
}`,
    notes: "Used by the home section rail and the message scroller.",
  },
  {
    slug: "theme-controls",
    kind: "component",
    title: "Theme switcher",
    description: "A compact choice between light, dark and system appearance.",
    group: "Foundations",
    preview: "primitive",
    variants: ["Light", "Dark", "System"],
    sources: ["apps/web/src/components/theme-switcher.tsx", "apps/web/src/components/ui/expand.tsx"],
    usage: `"use client";

import { ThemeSwitcher } from "@/components/theme-switcher";

export default function Example() {
  return (
    <ThemeSwitcher />
  );
}`,
    notes: "Requires the app ThemeProvider. The catalog shell provides it.",
  },
  {
    slug: "progressive-blur",
    kind: "component",
    title: "Progressive blur",
    description: "Layered background blur that softens an edge of the marketing scene.",
    group: "Motion",
    preview: "primitive",
    variants: ["Bottom-edge blur", "Blur strength", "Optional surface tint"],
    sources: ["packages/ui/src/progressive-blur.tsx"],
    usage: `"use client";

import { ProgressiveBlur } from "@agent-hub/ui";

export default function Example() {
  return (
    <>
      <ProgressiveBlur maxBlur={12} tint="var(--background)" />
    </>
  );
}`,
    notes: "This decorative layer is fixed to the bottom of the viewport. Keep it outside transformed or filtered ancestors; it fades as its scroll container reaches the bottom.",
  },
  {
    slug: "charts",
    kind: "component",
    title: "Line chart",
    description: "Time-series lines with hover and keyboard-readable values.",
    group: "Data display",
    preview: "platform",
    variants: ["Single series", "Multiple series", "Dashed series"],
    sources: ["apps/web/src/components/charts/arc/line-chart/line-chart.tsx", "apps/web/src/components/charts/arc/arc-frame.tsx"],
    usage: `"use client";

import { LineChart } from "@/components/charts/arc/line-chart/line-chart";

export default function Example() {
  return (
    <LineChart label="Answers" data={[{ key: "mon", label: "Mon", values: { answers: 42 } }]} series={[{ key: "answers", label: "Answers" }]} />
  );
}`,
  },
  {
    slug: "metric-cards",
    kind: "component",
    title: "Metric card",
    description: "One metric with its value, context, change and an optional trend slot.",
    group: "Data display",
    preview: "platform",
    variants: ["Default", "Bare", "Decimal", "Change", "Chart slot"],
    sources: ["apps/web/src/components/charts/arc/metric-card/metric-card.tsx"],
    usage: `"use client";

import { MetricCard } from "@/components/charts/arc/metric-card/metric-card";

export default function Example() {
  return (
    <>
      <MetricCard label="Conversations" value={1280} context="Last 30 days" change="+12%" />
    </>
  );
}`,
  },
  {
    slug: "gauges",
    kind: "component",
    title: "Gauge",
    description: "A single progress gauge with compact and semantic-threshold variants.",
    group: "Data display",
    preview: "platform",
    variants: ["Default", "Compact", "Thresholds"],
    sources: ["apps/web/src/components/charts/arc/gauge/gauge.tsx"],
    usage: `"use client";

import { Gauge } from "@/components/charts/arc/gauge/gauge";

export default function Example() {
  return (
    <Gauge value={72} label="Resolution rate" detail="Sample answers" />
  );
}`,
  },
  {
    slug: "chat-messages",
    kind: "component",
    title: "Message",
    description: "The role-alignment context and content parts for a single chat message.",
    group: "AI & chat",
    preview: "platform",
    variants: ["User", "Assistant", "Entrance"],
    sources: ["apps/web/src/components/agents/message.tsx"],
    usage: `"use client";

import { Message, MessageContent } from "@/components/agents/message";

export default function Example() {
  return (
    <Message from="assistant"><MessageContent>How can I help?</MessageContent></Message>
  );
}`,
  },
  {
    slug: "chat-composer",
    kind: "block",
    title: "Chat composer",
    description: "A complete message-entry control with model and action menus, submit and stop states.",
    group: "AI & chat",
    preview: "platform",
    variants: ["Draft", "Model menu", "Action menu", "Busy", "Stop"],
    sources: ["apps/web/src/components/agents/prompt-input.tsx", "apps/web/src/components/chat/composer-pulse.tsx", "apps/web/src/components/chat/voice-input-button.tsx", "apps/web/src/components/chat/speech-playback.tsx"],
    usage: `"use client";

import { PromptInput } from "@/components/agents/prompt-input";

export default function Example() {
  return (
    <>
      <PromptInput placeholder="Ask your assistant…" onSubmit={(message) => {}} models={[{ value: "auto", label: "Auto" }]} defaultModel="auto" />
    </>
  );
}`,
    notes: "Voice input and speech playback are optional integrations requiring configured endpoints and browser permission. The catalog demonstrates local message composition.",
  },
  {
    slug: "citations",
    kind: "component",
    title: "Citations",
    description: "An expandable source summary with named references and source counts.",
    group: "AI & chat",
    preview: "platform",
    variants: ["Closed", "Expanded", "Source count"],
    sources: ["apps/web/src/components/agents/citations.tsx"],
    usage: `"use client";

import { Citations } from "@/components/agents/citations";

export default function Example() {
  return (
    <>
      <Citations citations={[{ id: "guide", title: "Product guide", domain: "Documentation", url: "https://docs.ciele.app" }]} />
    </>
  );
}`,
  },
  {
    slug: "thinking",
    kind: "component",
    title: "Thinking panel",
    description: "A turn-level progress summary that expands to its execution trace.",
    group: "AI & chat",
    preview: "platform",
    variants: ["Active", "Complete", "Collapsed", "Expanded"],
    sources: ["apps/web/src/components/chat/thinking-panel.tsx", "apps/web/src/components/chat/thinking-timeline.tsx"],
    usage: `"use client";

import { ThinkingPanel } from "@/components/chat/thinking-panel";

export default function Example() {
  return (
    <ThinkingPanel steps={[]} phase="done" searchCount={0} active={false} summaryLabel="Thought for 1.8s" />
  );
}`,
  },
  {
    slug: "tool-cards",
    kind: "component",
    title: "Tool result",
    description: "One tool call with status, expandable output and a copy action.",
    group: "AI & chat",
    preview: "platform",
    variants: ["Running", "Success", "Error", "Cancelled", "Output"],
    sources: ["apps/web/src/components/agents/tool-result.tsx"],
    usage: `"use client";

import { ToolResult, ToolResultOutput } from "@/components/agents/tool-result";

export default function Example() {
  return (
    <ToolResult tool="searchKnowledge" icon={<span />} status="success" title="Search knowledge"><ToolResultOutput language="json">{'{"concepts":3}'}</ToolResultOutput></ToolResult>
  );
}`,
  },
  {
    slug: "attachments",
    kind: "component",
    title: "Attachment chips",
    description: "The attached-file strip with reading, ready, failed and removal states.",
    group: "AI & chat",
    preview: "platform",
    variants: ["Reading", "Ready", "Failed", "Remove", "Empty"],
    sources: ["apps/web/src/components/chat/attachment-chips.tsx"],
    usage: `"use client";

import { AttachmentChips } from "@/components/chat/attachment-chips";

export default function Example() {
  return (
    <AttachmentChips entries={[{ id: "policy", state: "ready", name: "account-policy.pdf", chars: 4820, token: "sample" }]} onRemove={() => {}} />
  );
}`,
    notes: "AttachmentInput is the hidden file-input helper used by the same composer integration.",
  },
  {
    slug: "reactions",
    kind: "component",
    title: "Emoji feedback",
    description: "One answer’s useful-or-not feedback selection.",
    group: "AI & chat",
    preview: "platform",
    variants: ["Unselected", "Positive", "Negative"],
    sources: ["apps/web/src/components/chat/emoji-feedback.tsx"],
    usage: `"use client";

import { EmojiFeedback } from "@/components/chat/emoji-feedback";

export default function Example() {
  return (
    <EmojiFeedback value={null} onChange={() => {}} />
  );
}`,
  },
  {
    slug: "study-exercises",
    kind: "block",
    title: "Study exercise",
    description: "The full self-assessment card and saved result for each supported study format.",
    group: "AI & chat",
    preview: "platform",
    variants: ["Multiple choice", "Drag words", "True / false", "Flashcards", "Completed", "Unfinished"],
    sources: ["apps/web/src/components/chat/study-exercise.tsx", "apps/web/src/components/chat/study-context.tsx"],
    usage: `"use client";

import { StudyExerciseReply } from "@/components/chat/study-exercise";

export default function Example() {
  return (
    <>
      <StudyExerciseReply exercise={{ id: "roles", title: "Organization roles", format: "multiple_choice",
        questions: [{ id: "one", prompt: "Who manages organization settings?", options: ["Admin", "Viewer"] }],
        answers: [{ questionId: "one", answer: "Admin", correct: true, correctAnswer: "Admin", explanation: "Admins manage settings." }] }} />
    </>
  );
}`,
    notes: "Live exercise checking reads StudyProvider and persists answers server-side. Catalog examples show local saved-result snapshots.",
  },
  {
    slug: "task-progress",
    kind: "component",
    title: "Task progress",
    description: "A plan's pending, running, completed and cancelled steps in one collapsible list.",
    group: "AI & chat",
    preview: "platform",
    variants: ["TodoList", "Pending", "In progress", "Completed", "Completion collapse"],
    sources: ["apps/web/src/components/agents/todo-list.tsx"],
    usage: `"use client";

import { TodoList } from "@/components/agents/todo-list";

export default function Example() {
  return (
    <>
      <TodoList items={[{ id: "search", title: "Search knowledge", status: "completed" }, { id: "answer", title: "Write the answer", status: "in-progress" }]} />
    </>
  );
}`,
  },
  {
    slug: "notifications",
    kind: "component",
    title: "Notification stack",
    description: "Stacked notices with expansion, dismissal and semantic status.",
    group: "Surfaces",
    preview: "platform",
    variants: ["Stacked", "Expanded", "Dismissed", "Success", "Warning", "Info"],
    sources: ["apps/web/src/components/motion/notification-stack.tsx"],
    usage: `"use client";

import { NotificationStack } from "@/components/motion/notification-stack";

export default function Example() {
  return (
    <>
      <NotificationStack items={[{ id: "saved", title: "Changes saved", description: "Your assistant is up to date.", status: "success" }]}
        onViewAll={() => {}} onClose={() => {}} collapsedLabel="1 notification" expandedLabel="View all notifications" />
    </>
  );
}`,
  },
  {
    slug: "editors",
    kind: "block",
    title: "Canvas editor",
    description: "A complete canvas control surface with selection, pan, zoom and radial commands.",
    group: "Forms",
    preview: "platform",
    variants: ["Select", "Pan", "Zoom", "Fit", "Radial actions", "Field"],
    sources: ["apps/web/src/components/assistant/canvas-toolbar.tsx", "apps/web/src/components/assistant/radial-menu.tsx", "apps/web/src/components/assistant/flow-canvas-field.tsx"],
    usage: `"use client";

import { CanvasToolbar } from "@/components/assistant/canvas-toolbar";

export default function Example() {
  return (
    <>
      <CanvasToolbar tool="select" onToolChange={() => {}} pickerOpen={false} onPickerOpenChange={() => {}} picker={null} readOnly={false} onFit={() => {}} onZoomIn={() => {}} onZoomOut={() => {}} controls={[]} />
    </>
  );
}`,
    notes: "The parent owns graph data and actions. FlowCanvasField requires ReactFlowProvider and a root ref.",
  },
  {
    slug: "file-tree",
    kind: "component",
    title: "Resource tree",
    description: "Nested folders and resources with active selection in chat and preview sidebars.",
    group: "Navigation",
    preview: "platform",
    variants: ["AISidebar", "Folders", "Resources", "Active row", "Disabled resource"],
    sources: ["apps/web/src/components/agents/ai-sidebar.tsx"],
    usage: `"use client";

import { AISidebar } from "@/components/agents/ai-sidebar";

export default function Example() {
  return (
    <>
      <AISidebar items={[{ id: "guide", label: "Product guide", kind: "file" }]}
        activeId="guide" onActiveChange={() => {}} />
    </>
  );
}`,
    notes: "This is the resource navigation used by assistant preview, widget history and teammate chat. It receives resource data and optional interaction handlers from its parent.",
  },
  {
    slug: "navigation",
    kind: "component",
    title: "Breadcrumb",
    description: "A hierarchical path with compact overflow for long navigation trails.",
    group: "Navigation",
    preview: "platform",
    variants: ["Short path", "Nested path", "Collapsed overflow"],
    sources: ["apps/web/src/components/motion/breadcrumb.tsx"],
    usage: `"use client";

import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/motion/breadcrumb";

export default function Example() {
  return (
    <>
      <Breadcrumb><BreadcrumbList><BreadcrumbItem><BreadcrumbLink href="/">Ciele</BreadcrumbLink></BreadcrumbItem><BreadcrumbSeparator /><BreadcrumbItem><BreadcrumbPage>Components</BreadcrumbPage></BreadcrumbItem></BreadcrumbList></Breadcrumb>
    </>
  );
}`,
  },
  {
    slug: "brand",
    kind: "component",
    title: "Ciele AI mark",
    description: "The Ciele AI identity mark at different sizes.",
    group: "Foundations",
    preview: "platform",
    variants: ["Logo", "Sizes"],
    sources: ["apps/web/src/components/teammates/ciele-ai-logo.tsx"],
    usage: `"use client";

import { CieleAiLogo } from "@/components/teammates/ciele-ai-logo";

export default function Example() {
  return (
    <CieleAiLogo className="size-12" />
  );
}`,
  },
  {
    slug: "password-input",
    kind: "component",
    title: "Password input",
    description: "A password field with an accessible visibility control.",
    group: "Forms",
    preview: "primitive",
    variants: ["Hidden", "Visible", "Disabled"],
    sources: ["packages/ui/src/input.tsx"],
    usage: `"use client";

import { PasswordInput } from "@agent-hub/ui";

export default function Example() {
  return (
    <PasswordInput aria-label="Password" />
  );
}`,
  },
  {
    slug: "motion-input",
    kind: "component",
    title: "Motion input",
    description: "A labelled field that shares the console input geometry and owns focus and error feedback.",
    group: "Forms",
    preview: "primitive",
    variants: ["Console density", "Comfortable density", "Label", "Error", "Reserved error space", "Disabled", "Static"],
    sources: ["apps/web/src/components/motion/input.tsx"],
    usage: `"use client";

import { Input } from "@/components/motion/input";

export default function Example() {
  return (
    <Input label="Email" type="email" />
  );
}`,
    notes: "The field uses the shared Input. reserveErrorRow keeps validation space stable; static suppresses local motion.",
  },
  {
    slug: "field-header",
    kind: "component",
    title: "Field header",
    description: "A field title and hint with the same typographic weight as other form labels.",
    group: "Foundations",
    preview: "primitive",
    variants: ["Title", "Hint"],
    sources: ["apps/web/src/components/settings/field-header.tsx"],
    usage: `"use client";

import { FieldHeader } from "@/components/settings/field-header";

export default function Example() {
  return (
    <FieldHeader title="Nickname" hint="Shown in the chat header." />
  );
}`,
  },
  {
    slug: "section-heading",
    kind: "component",
    title: "Section heading",
    description: "A page or group heading with an operational console variant and a marketing variant.",
    group: "Foundations",
    preview: "primitive",
    variants: ["Console", "Marketing", "Mock", "Heading levels"],
    sources: ["apps/web/src/components/ui/section-heading.tsx"],
    usage: `"use client";

import { BookOpen } from "lucide-react";
import { SectionHeading } from "@/components/ui/section-heading";

export default function Example() {
  return (
    <SectionHeading icon={BookOpen} title="Knowledge" description="Sources your assistant can use." />
  );
}`,
  },
  {
    slug: "status-badge",
    kind: "component",
    title: "Status badge",
    description: "A status dot and label for a live, idle or failed operation.",
    group: "Data display",
    preview: "primitive",
    variants: ["Online", "Offline", "Error", "Info"],
    sources: ["apps/web/src/components/spaceui/status-badge.tsx"],
    usage: `"use client";

import { StatusBadge } from "@/components/spaceui/status-badge";

export default function Example() {
  return (
    <StatusBadge status="online" primaryText="Active" />
  );
}`,
  },
  {
    slug: "source-status-badge",
    kind: "component",
    title: "Source status badge",
    description: "A knowledge source status with indexing and failure states.",
    group: "Data display",
    preview: "primitive",
    variants: ["Ready", "Processing", "Failed"],
    sources: ["apps/web/src/components/knowledge/source-status-badge.tsx"],
    usage: `"use client";

import { SourceStatusBadge } from "@/components/knowledge/source-status-badge";

export default function Example() {
  return (
    <SourceStatusBadge status="ready" />
  );
}`,
  },
  {
    slug: "trust-badge",
    kind: "component",
    title: "Trust badge",
    description: "An assistant flow trust tier in one compact marker.",
    group: "Data display",
    preview: "primitive",
    variants: ["Watch", "Queue", "Auto"],
    sources: ["apps/web/src/components/assistant/trust-badge.tsx"],
    usage: `"use client";

import { TooltipProvider } from "@agent-hub/ui";
import { TrustBadge } from "@/components/assistant/trust-badge";

export default function Example() {
  return (
    <TooltipProvider><TrustBadge trust={{ assistantId: "sample", flowId: "default", organizationId: "sample", tier: "auto", previousTier: null, runs: 20, passes: 18, computedAt: "2026-10-04T12:00:00Z" }} /></TooltipProvider>
  );
}`,
  },
  {
    slug: "spotlight-card",
    kind: "component",
    title: "Spotlight card",
    description: "A content surface with a pointer-following highlight.",
    group: "Surfaces",
    preview: "primitive",
    variants: ["Pointer highlight", "Static content"],
    sources: ["apps/web/src/components/marketing/spotlight-card.tsx", "apps/web/src/components/core/spotlight.tsx"],
    usage: `"use client";

import { SpotlightCard } from "@/components/marketing/spotlight-card";

export default function Example() {
  return (
    <SpotlightCard><p>Explore Ciele</p></SpotlightCard>
  );
}`,
  },
  {
    slug: "feature-card",
    kind: "block",
    title: "Feature card",
    description: "A marketing feature with a preview, expanded content and related navigation.",
    group: "Surfaces",
    preview: "primitive",
    variants: ["Collapsed", "Expanded"],
    sources: ["apps/web/src/components/home/feature-card.tsx", "apps/web/src/components/core/morphing-dialog.tsx"],
    usage: `"use client";

import { FeatureCard } from "@/components/home/feature-card";

export default function Example() {
  const feature = { title: "Knowledge", body: "Grounded answers", visual: () => <p>Connected sources</p>, details: ["Answers cite their sources."] };

  return (
    <FeatureCard feature={feature} />
  );
}`,
  },
  {
    slug: "feature-card-face",
    kind: "component",
    title: "Feature card face",
    description: "The title, description and icon face reused by a feature card.",
    group: "Surfaces",
    preview: "primitive",
    variants: ["Title", "Description", "Preview placeholder"],
    sources: ["apps/web/src/components/home/feature-card-face.tsx"],
    usage: `"use client";

import { FeatureCardFace } from "@/components/home/feature-card-face";

export default function Example() {
  const feature = { title: "Knowledge", body: "Grounded answers", visual: () => <p>Connected sources</p>, details: ["Answers cite their sources."] };

  return (
    <FeatureCardFace feature={feature} />
  );
}`,
  },
  {
    slug: "morphing-modal",
    kind: "component",
    title: "Morphing modal",
    description: "An accessible modal whose content can transition between views.",
    group: "Surfaces",
    preview: "primitive",
    variants: ["Open", "View change", "Close"],
    sources: ["apps/web/src/components/motion/morphing-modal.tsx"],
    usage: `"use client";

import { useState } from "react";
import { MorphingModal } from "@/components/motion/morphing-modal";

export default function Example() {
  const [view, setView] = useState<string | null>(null);

  return (
    <><button type="button" onClick={() => setView("first")}>Open details</button><MorphingModal viewId={view} onClose={() => setView(null)} title="Details"><p>First view</p></MorphingModal></>
  );
}`,
  },
  {
    slug: "morphing-dialog",
    kind: "component",
    title: "Morphing dialog",
    description: "A shared-layout dialog that grows from its own trigger.",
    group: "Surfaces",
    preview: "primitive",
    variants: ["Trigger", "Content", "Close"],
    sources: ["apps/web/src/components/core/morphing-dialog.tsx"],
    usage: `"use client";

import { MorphingDialog, MorphingDialogTrigger, MorphingDialogContent, MorphingDialogContainer, MorphingDialogTitle } from "@/components/core/morphing-dialog";

export default function Example() {
  return (
    <MorphingDialog><MorphingDialogTrigger ariaLabel="View details">View details</MorphingDialogTrigger><MorphingDialogContainer><MorphingDialogContent><MorphingDialogTitle>Details</MorphingDialogTitle><p>Expanded content</p></MorphingDialogContent></MorphingDialogContainer></MorphingDialog>
  );
}`,
  },
  {
    slug: "confirm-delete",
    kind: "block",
    title: "Delete confirmation",
    description: "A destructive-action dialog with a deliberate confirmation step.",
    group: "Surfaces",
    preview: "primitive",
    variants: ["Ready", "Pending", "Error"],
    sources: ["apps/web/src/components/ui/confirm-delete-modal.tsx", "apps/web/src/components/motion/morphing-modal.tsx"],
    usage: `"use client";

import { ConfirmDeleteModal } from "@/components/ui/confirm-delete-modal";

export default function Example() {
  return (
    <ConfirmDeleteModal open={false} onClose={() => {}} title="Delete source" description="This removes the source." onConfirm={async () => {}} />
  );
}`,
  },
  {
    slug: "morph-popover",
    kind: "component",
    title: "Morph popover",
    description: "An anchored menu that transitions between related content views.",
    group: "Surfaces",
    preview: "primitive",
    variants: ["Open", "View change", "Close"],
    sources: ["apps/web/src/components/motion/popover-morph.tsx"],
    usage: `"use client";

import { useState } from "react";
import { MorphPopover, MorphPopoverTrigger, MorphPopoverContent } from "@/components/motion/popover-morph";

export default function Example() {
  const [open, setOpen] = useState(false);

  return (
    <MorphPopover open={open} onOpenChange={setOpen}><MorphPopoverTrigger><button type="button">Details</button></MorphPopoverTrigger><MorphPopoverContent side="bottom" align="start"><p>Details</p></MorphPopoverContent></MorphPopover>
  );
}`,
  },
  {
    slug: "context-menu",
    kind: "component",
    title: "Context menu",
    description: "A command menu opened from a surface context action.",
    group: "Navigation",
    preview: "primitive",
    variants: ["Actions", "Disabled item"],
    sources: ["apps/web/src/components/motion/context-menu.tsx"],
    usage: `"use client";

import { ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuItem } from "@/components/motion/context-menu";

export default function Example() {
  return (
    <ContextMenu><ContextMenuTrigger><div>Open context actions here</div></ContextMenuTrigger><ContextMenuContent><ContextMenuItem>Duplicate</ContextMenuItem></ContextMenuContent></ContextMenu>
  );
}`,
  },
  {
    slug: "hover-highlight",
    kind: "component",
    title: "Hover highlight",
    description: "A shared active background for menu items and selectable rows.",
    group: "Motion",
    preview: "primitive",
    variants: ["Hover", "Focus", "Disabled"],
    sources: ["apps/web/src/components/ui/hover-highlight.tsx"],
    usage: `"use client";

import { HoverHighlight } from "@/components/ui/hover-highlight";

export default function Example() {
  return (
    <HoverHighlight><button type="button">First option</button><button type="button">Second option</button></HoverHighlight>
  );
}`,
  },
  {
    slug: "table-row-menu",
    kind: "component",
    title: "Table row menu",
    description: "A compact overflow control for one row’s actions.",
    group: "Navigation",
    preview: "primitive",
    variants: ["Open", "Destructive action", "Disabled action"],
    sources: ["apps/web/src/components/ui/table-menu.tsx"],
    usage: `"use client";

import { TableRowMenu } from "@/components/ui/table-menu";

export default function Example() {
  return (
    <TableRowMenu title="Account policy" actions={[{ label: "Archive", onSelect: () => {} }]}><div tabIndex={0}>Account policy</div></TableRowMenu>
  );
}`,
  },
  {
    slug: "rail-panel",
    kind: "component",
    title: "Rail panel",
    description: "A collapsible side rail for details alongside a chat.",
    group: "Surfaces",
    preview: "primitive",
    variants: ["Open", "Collapsed"],
    sources: ["apps/web/src/components/chat/rail-panel.tsx"],
    usage: `"use client";

import { RailPanel } from "@/components/chat/rail-panel";

export default function Example() {
  return (
    <RailPanel variant="page" title="Details" labels={{ show: "Show details", hide: "Hide details", resize: "Resize details" }}><p>Conversation details</p></RailPanel>
  );
}`,
  },
  {
    slug: "table",
    kind: "component",
    title: "Table",
    description: "Native semantic table parts for a simple read-only tabular layout.",
    group: "Data display",
    preview: "primitive",
    variants: ["Header", "Rows", "Cells", "Caption"],
    sources: ["apps/web/src/components/ui/table.tsx"],
    usage: `"use client";

import { Table, TableHeader, TableHead, TableBody, TableRow, TableCell } from "@/components/ui/table";

export default function Example() {
  return (
    <Table><caption>Connected documents</caption><TableHeader><TableRow><TableHead>Name</TableHead></TableRow></TableHeader><TableBody><TableRow><TableCell>Account policy</TableCell></TableRow></TableBody></Table>
  );
}`,
  },
  {
    slug: "table-column-header",
    kind: "component",
    title: "Table column header",
    description: "A sortable and filterable column control with a stable heading.",
    group: "Data display",
    preview: "primitive",
    variants: ["Sorting", "Filter menu", "Active filter"],
    sources: ["apps/web/src/components/ui/table-column-header.tsx"],
    usage: `"use client";

import { TableColumnHeader, useClientSort } from "@/components/ui/table-column-header";
import { Table, TableHeader, TableRow } from "@/components/ui/table";

export default function Example() {
  const sort = useClientSort();

  return (
    <Table><TableHeader><TableRow><TableColumnHeader label="Name" sort={sort.column("name")} /></TableRow></TableHeader></Table>
  );
}`,
  },
  {
    slug: "table-pagination",
    kind: "component",
    title: "Table pagination",
    description: "Page navigation and a page-size control for a result set.",
    group: "Data display",
    preview: "primitive",
    variants: ["First page", "Next page", "Page size"],
    sources: ["apps/web/src/components/ui/table-pagination.tsx"],
    usage: `"use client";

import { TablePagination } from "@/components/ui/table-pagination";

export default function Example() {
  return (
    <TablePagination total={60} page={1} pageSize={10} noun="assistant" onPageChange={() => {}} onPageSizeChange={() => {}} />
  );
}`,
  },
  {
    slug: "table-open-cell",
    kind: "component",
    title: "Table open cell",
    description: "A row-opening link that preserves normal link and keyboard behavior.",
    group: "Data display",
    preview: "primitive",
    variants: ["Link", "Hover", "Keyboard focus"],
    sources: ["apps/web/src/components/ui/table-open-cell.tsx"],
    usage: `"use client";

import { TableOpenCell } from "@/components/ui/table-open-cell";

export default function Example() {
  return (
    <TableOpenCell href="/components/table" label="Open account policy">Account policy</TableOpenCell>
  );
}`,
  },
  {
    slug: "table-selection",
    kind: "component",
    title: "Table selection",
    description: "The shared row-checkbox and bulk-action contract.",
    group: "Data display",
    preview: "primitive",
    variants: ["Single row", "Select all", "Indeterminate", "Bulk actions"],
    sources: ["apps/web/src/components/ui/table-selection.tsx"],
    usage: `"use client";

import { SelectRowCell } from "@/components/ui/table-selection";

export default function Example() {
  return (
    <SelectRowCell checked={false} onToggle={() => {}} label="Select policy" />
  );
}`,
  },
  {
    slug: "motion-table",
    kind: "block",
    title: "Motion data table",
    description: "A sortable operational table with animated row values and an empty-state slot.",
    group: "Data display",
    preview: "primitive",
    variants: ["Sorting", "Rows", "Empty state", "Footer"],
    sources: ["apps/web/src/components/motion/table.tsx"],
    usage: `"use client";

import { Table } from "@/components/motion/table";

export default function Example() {
  return (
    <Table data={[{ id: "policy", name: "Account policy" }]} getRowId={(row) => row.id} emptyState="No documents" footer={null} columns={[{ key: "name", header: "Name", accessor: (row) => row.name }]} />
  );
}`,
  },
  {
    slug: "availability-scheduler",
    kind: "block",
    title: "Availability scheduler",
    description: "A weekly opening-hours editor with enabled days and multiple time ranges.",
    group: "Forms",
    preview: "primitive",
    variants: ["Enabled day", "Disabled day", "Time ranges"],
    sources: ["apps/web/src/components/help-desks/availability-scheduler/index.tsx", "apps/web/src/components/help-desks/availability-scheduler/day-row.tsx"],
    usage: `"use client";

import { useState } from "react";
import { AvailabilityScheduler } from "@/components/help-desks/availability-scheduler";
import type { WeekHours } from "@/components/help-desks/availability-scheduler/types";

export default function Example() {
  const [hours, setHours] = useState<WeekHours>({
    monday: { enabled: false, ranges: [] },
    tuesday: { enabled: false, ranges: [] },
    wednesday: { enabled: false, ranges: [] },
    thursday: { enabled: false, ranges: [] },
    friday: { enabled: false, ranges: [] },
    saturday: { enabled: false, ranges: [] },
    sunday: { enabled: false, ranges: [] },
  });

  return (
    <AvailabilityScheduler value={hours} onChange={setHours} />
  );
}`,
  },
  {
    slug: "user-avatar",
    kind: "component",
    title: "User avatar",
    description: "A person’s image with a deterministic fallback when no image is available.",
    group: "Foundations",
    preview: "primitive",
    variants: ["Image", "Fallback", "Sizes"],
    sources: ["apps/web/src/components/ui/user-avatar.tsx"],
    usage: `"use client";

import { UserAvatar } from "@/components/ui/user-avatar";

export default function Example() {
  return (
    <UserAvatar email="alex@example.com" />
  );
}`,
  },
  {
    slug: "teammate-avatar",
    kind: "component",
    title: "Teammate avatar",
    description: "A Teammate identity mark with its own configured seed.",
    group: "Foundations",
    preview: "primitive",
    variants: ["Default", "Seeded", "Sizes"],
    sources: ["apps/web/src/components/teammates/teammate-avatar.tsx"],
    usage: `"use client";

import { TeammateAvatar } from "@/components/teammates/teammate-avatar";

export default function Example() {
  return (
    <TeammateAvatar teammate={{ id: "support", name: "Support", avatarSeed: "support" }} />
  );
}`,
  },
  {
    slug: "group-avatar-cluster",
    kind: "component",
    title: "Group avatar cluster",
    description: "A compact group identity built from its member faces.",
    group: "Foundations",
    preview: "primitive",
    variants: ["Small group", "Overflow", "Sizes"],
    sources: ["apps/web/src/components/teammates/group-avatar-cluster.tsx"],
    usage: `"use client";

import { GroupAvatarCluster } from "@/components/teammates/group-avatar-cluster";

export default function Example() {
  return (
    <GroupAvatarCluster faces={[{ id: "alex", seed: "alex" }]} participantCount={1} />
  );
}`,
  },
  {
    slug: "assignees",
    kind: "block",
    title: "Assignee picker",
    description: "Member faces and a searchable add-person picker presented as one operation.",
    group: "Forms",
    preview: "primitive",
    variants: ["Row stack", "Grid stack", "Search", "Add member"],
    sources: ["apps/web/src/components/ui/assignees.tsx"],
    usage: `"use client";

import { Assignees } from "@/components/ui/assignees";

export default function Example() {
  return (
    <Assignees assigned={[]} groups={[]} addLabel="Add person" />
  );
}`,
  },
  {
    slug: "feather-icon",
    kind: "component",
    title: "Feather icon",
    description: "A drawn feather glyph with a pointer-triggered animation.",
    group: "Foundations",
    preview: "primitive",
    variants: ["Idle", "Hovered"],
    sources: ["apps/web/src/components/ui/feather-icon.tsx"],
    usage: `"use client";

import { FeatherIcon } from "@/components/ui/feather-icon";

export default function Example() {
  return (
    <FeatherIcon />
  );
}`,
  },
  {
    slug: "flow-button-icon",
    kind: "component",
    title: "Flow button icon",
    description: "The icon contract used by configured flow buttons.",
    group: "Foundations",
    preview: "primitive",
    variants: ["Configured icons", "No icon"],
    sources: ["apps/web/src/components/chat/flow-button-icon.tsx"],
    usage: `"use client";

import { FlowButtonIcon } from "@/components/chat/flow-button-icon";

export default function Example() {
  return (
    <FlowButtonIcon icon="external_link" />
  );
}`,
  },
  {
    slug: "sidebar-toggle-icon",
    kind: "component",
    title: "Sidebar toggle icon",
    description: "A control glyph that reflects an expanded or collapsed sidebar.",
    group: "Foundations",
    preview: "primitive",
    variants: ["Expanded", "Collapsed"],
    sources: ["apps/web/src/components/ui/sidebar-toggle-icon.tsx"],
    usage: `"use client";

import { SidebarToggleIcon } from "@/components/ui/sidebar-toggle-icon";

export default function Example() {
  return (
    <SidebarToggleIcon isOpen={true} />
  );
}`,
  },
  {
    slug: "bot-icon",
    kind: "component",
    title: "Bot icon",
    description: "A local assistant glyph with the shared icon animation contract.",
    group: "Foundations",
    preview: "primitive",
    variants: ["Idle", "Animated"],
    sources: ["apps/web/src/components/ui/icons/bot.tsx"],
    usage: `"use client";

import { BotIcon } from "@/components/ui/icons/bot";

export default function Example() {
  return (
    <BotIcon size={24} />
  );
}`,
  },
  {
    slug: "code-block",
    kind: "component",
    title: "Code block",
    description: "A code snippet with optional language tabs and clipboard feedback.",
    group: "Data display",
    preview: "primitive",
    variants: ["Single snippet", "Tabs", "Copy"],
    sources: ["apps/web/src/components/ui/code-block.tsx"],
    usage: `"use client";

import { CodeBlock } from "@/components/ui/code-block";

export default function Example() {
  return (
    <CodeBlock code="pnpm verify" language="bash" />
  );
}`,
  },
  {
    slug: "agent-code",
    kind: "component",
    title: "Agent code",
    description: "Syntax-highlighted code lines shared by agent tool output.",
    group: "AI & chat",
    preview: "primitive",
    variants: ["Syntax highlighting", "Code lines", "Languages"],
    sources: ["apps/web/src/components/agents/agent-code.tsx"],
    usage: `"use client";

import { AgentCode } from "@/components/agents/agent-code";

export default function Example() {
  return (
    <AgentCode code="const ready = true;" language="typescript" />
  );
}`,
  },
  {
    slug: "agent-code-block",
    kind: "component",
    title: "Agent code block",
    description: "A complete syntax-highlighted chat code surface with language metadata and clipboard feedback.",
    group: "AI & chat",
    preview: "primitive",
    variants: ["Language", "Syntax highlighting", "Copy"],
    sources: ["apps/web/src/components/agents/code-block.tsx"],
    usage: `"use client";

import { CodeBlock } from "@/components/agents/code-block";

export default function Example() {
  return (
    <CodeBlock language="typescript" code="const ready = true;" />
  );
}`,
  },
  {
    slug: "rolling-number",
    kind: "component",
    title: "Rolling number",
    description: "Numeric updates animate in place with a stable tabular layout.",
    group: "Motion",
    preview: "primitive",
    variants: ["Positive", "Negative", "Precision"],
    sources: ["apps/web/src/components/motion/rolling-number.tsx"],
    usage: `"use client";

import { RollingNumber } from "@/components/motion/rolling-number";

export default function Example() {
  return (
    <RollingNumber value={128} />
  );
}`,
  },
  {
    slug: "text-shimmer",
    kind: "component",
    title: "Text shimmer",
    description: "A subtle moving highlight for text that represents active work.",
    group: "Motion",
    preview: "primitive",
    variants: ["Active", "Reduced motion"],
    sources: ["apps/web/src/components/motion/text-shimmer.tsx"],
    usage: `"use client";

import { TextShimmer } from "@/components/motion/text-shimmer";

export default function Example() {
  return (
    <TextShimmer>Preparing the answer…</TextShimmer>
  );
}`,
  },
  {
    slug: "roll-row",
    kind: "component",
    title: "Rolling row",
    description: "A row context that limits initial text entrances and preserves later value updates.",
    group: "Motion",
    preview: "primitive",
    variants: ["Entrance", "Updated cell", "Long lists"],
    sources: ["apps/web/src/components/motion/roll-in-text.tsx"],
    usage: `"use client";

import { RollInText, RollRow } from "@/components/motion/roll-in-text";

export default function Example() {
  return (
    <RollRow index={0}><RollInText text="Account policy" /></RollRow>
  );
}`,
  },
  {
    slug: "page-reveal",
    kind: "component",
    title: "Page reveal",
    description: "A restrained entrance for an infrequent page or section change.",
    group: "Motion",
    preview: "primitive",
    variants: ["Entrance", "Reduced motion"],
    sources: ["apps/web/src/components/motion/page-reveal.tsx", "apps/web/src/components/home/reveal.tsx"],
    usage: `"use client";

import { PageReveal } from "@/components/motion/page-reveal";

export default function Example() {
  return (
    <PageReveal><p>Page content</p></PageReveal>
  );
}`,
  },
  {
    slug: "skeleton-reveal",
    kind: "component",
    title: "Skeleton reveal",
    description: "A transition that reveals content after its shaped placeholder.",
    group: "Motion",
    preview: "primitive",
    variants: ["Placeholder", "Content", "Reduced motion"],
    sources: ["apps/web/src/components/spectrumui/skeleton-reveal.tsx"],
    usage: `"use client";

import { SkeletonReveal } from "@/components/spectrumui/skeleton-reveal";

export default function Example() {
  return (
    <SkeletonReveal loading={false} skeleton={<div className="h-24 bg-muted" />}><p>Your content is ready.</p></SkeletonReveal>
  );
}`,
  },
  {
    slug: "sound-switcher",
    kind: "component",
    title: "Sound switcher",
    description: "A compact device preference for interface audio.",
    group: "Foundations",
    preview: "primitive",
    variants: ["On", "Off"],
    sources: ["apps/web/src/components/sound-switcher.tsx", "packages/ui/src/feedback/provider.tsx"],
    usage: `"use client";

import { SoundSwitcher } from "@/components/sound-switcher";

export default function Example() {
  return (
    <SoundSwitcher />
  );
}`,
  },
  {
    slug: "appearance-settings",
    kind: "block",
    title: "Appearance settings",
    description: "Theme, avatar and interface-feedback settings presented as one coherent form.",
    group: "Forms",
    preview: "primitive",
    variants: ["Theme", "Avatar", "Sound", "Haptics"],
    sources: ["apps/web/src/components/settings/theme-settings-client.tsx"],
    usage: `"use client";

import { ThemeSettingsClient } from "@/components/settings/theme-settings-client";

export default function Example() {
  return (
    <ThemeSettingsClient />
  );
}`,
  },
  {
    slug: "magnetic",
    kind: "component",
    title: "Magnetic target",
    description: "A pointer-responsive wrapper for an infrequent marketing target.",
    group: "Motion",
    preview: "primitive",
    variants: ["Hover", "Rest", "Reduced motion"],
    sources: ["apps/web/src/components/core/magnetic.tsx", "apps/web/src/components/core/magnetic-motion.tsx"],
    usage: `"use client";

import { Magnetic } from "@/components/core/magnetic";

export default function Example() {
  return (
    <Magnetic><button type="button">Explore</button></Magnetic>
  );
}`,
  },
  {
    slug: "slide-to-confirm",
    kind: "component",
    title: "Slide to confirm",
    description: "A deliberate drag gesture for a destructive action.",
    group: "Forms",
    preview: "primitive",
    variants: ["Ready", "Dragging", "Confirmed"],
    sources: ["apps/web/src/components/ui/slide-to-confirm.tsx"],
    usage: `"use client";

import { SlideToConfirm } from "@/components/ui/slide-to-confirm";

export default function Example() {
  return (
    <SlideToConfirm label="Slide to delete" confirmedLabel="Deleted" onConfirm={() => {}} />
  );
}`,
  },
  {
    slug: "bar-chart",
    kind: "component",
    title: "Bar chart",
    description: "Categorical values as bars.",
    group: "Data display",
    preview: "platform",
    variants: ["Default", "Updated data", "Keyboard focus"],
    sources: ["apps/web/src/components/charts/arc/bar-chart/bar-chart.tsx"],
    usage: `"use client";

import { BarChart } from "@/components/charts/arc/bar-chart/bar-chart";

export default function Example() {
  return (
    <BarChart label="Conversations" period="Sample week" data={[{ key: "mon", label: "Mon", value: 42 }]} />
  );
}`,
  },
  {
    slug: "donut-chart",
    kind: "component",
    title: "Donut chart",
    description: "Parts of a whole as labelled ring segments.",
    group: "Data display",
    preview: "platform",
    variants: ["Default", "Updated data", "Keyboard focus"],
    sources: ["apps/web/src/components/charts/arc/donut-chart/donut-chart.tsx"],
    usage: `"use client";

import { DonutChart } from "@/components/charts/arc/donut-chart/donut-chart";

export default function Example() {
  return (
    <DonutChart label="Answer types" data={[{ key: "resolved", label: "Resolved", value: 80 }, { key: "escalated", label: "Escalated", value: 20 }]} />
  );
}`,
  },
  {
    slug: "waffle-chart",
    kind: "component",
    title: "Waffle chart",
    description: "A part-to-whole distribution rendered as a grid.",
    group: "Data display",
    preview: "platform",
    variants: ["Default", "Updated data", "Keyboard focus"],
    sources: ["apps/web/src/components/charts/arc/waffle-chart/waffle-chart.tsx"],
    usage: `"use client";

import { WaffleChart } from "@/components/charts/arc/waffle-chart/waffle-chart";

export default function Example() {
  return (
    <WaffleChart label="Resolution" data={[{ key: "resolved", label: "Resolved", value: 80 }, { key: "escalated", label: "Escalated", value: 20 }]} />
  );
}`,
  },
  {
    slug: "streamgraph",
    kind: "component",
    title: "Streamgraph",
    description: "Changes in multiple categories across a shared time axis.",
    group: "Data display",
    preview: "platform",
    variants: ["Default", "Updated data", "Keyboard focus"],
    sources: ["apps/web/src/components/charts/arc/streamgraph/streamgraph.tsx"],
    usage: `"use client";

import { Streamgraph } from "@/components/charts/arc/streamgraph/streamgraph";

export default function Example() {
  return (
    <Streamgraph label="Conversation mix" data={[{ key: "mon", label: "Mon", values: { answers: 42 } }]} series={[{ key: "answers", label: "Answers" }]} />
  );
}`,
  },
  {
    slug: "slope-chart",
    kind: "component",
    title: "Slope chart",
    description: "A comparison between two periods for each category.",
    group: "Data display",
    preview: "platform",
    variants: ["Default", "Updated data", "Keyboard focus"],
    sources: ["apps/web/src/components/charts/arc/slope-chart/slope-chart.tsx"],
    usage: `"use client";

import { SlopeChart } from "@/components/charts/arc/slope-chart/slope-chart";

export default function Example() {
  return (
    <SlopeChart label="Resolution" startLabel="Before" endLabel="After" data={[{ key: "policy", label: "Policy", start: 58, end: 82 }]} />
  );
}`,
  },
  {
    slug: "ridgeline",
    kind: "component",
    title: "Ridgeline",
    description: "The distribution of values for each compared category.",
    group: "Data display",
    preview: "platform",
    variants: ["Default", "Updated data", "Keyboard focus"],
    sources: ["apps/web/src/components/charts/arc/ridgeline/ridgeline.tsx"],
    usage: `"use client";

import { Ridgeline } from "@/components/charts/arc/ridgeline/ridgeline";

export default function Example() {
  return (
    <Ridgeline label="Response time" unit="s" series={[{ id: "assistant", label: "Assistant", values: [1, 2, 3, 5, 8] }]} />
  );
}`,
  },
  {
    slug: "treemap",
    kind: "component",
    title: "Treemap",
    description: "Hierarchical category values within one area.",
    group: "Data display",
    preview: "platform",
    variants: ["Default", "Updated data", "Keyboard focus"],
    sources: ["apps/web/src/components/charts/arc/treemap/treemap.tsx"],
    usage: `"use client";

import { Treemap } from "@/components/charts/arc/treemap/treemap";

export default function Example() {
  return (
    <Treemap label="Knowledge" data={{ id: "root", label: "Collections", children: [{ id: "policies", label: "Policies", value: 42 }] }} />
  );
}`,
  },
  {
    slug: "brush-chart",
    kind: "component",
    title: "Brush chart",
    description: "A time series with an interactive selection window.",
    group: "Data display",
    preview: "platform",
    variants: ["Default", "Updated data", "Keyboard focus"],
    sources: ["apps/web/src/components/charts/arc/brush-chart/brush-chart.tsx"],
    usage: `"use client";

import { BrushChart } from "@/components/charts/arc/brush-chart/brush-chart";

export default function Example() {
  return (
    <BrushChart label="Daily conversations" data={[{ date: Date.UTC(2026, 9, 1), value: 42 }, { date: Date.UTC(2026, 9, 2), value: 58 }]} />
  );
}`,
  },
  {
    slug: "activity-heatmap",
    kind: "component",
    title: "Activity heatmap",
    description: "Daily intensity with focus and date selection.",
    group: "Data display",
    preview: "platform",
    variants: ["Default", "Updated data", "Keyboard focus"],
    sources: ["apps/web/src/components/charts/arc/activity-heatmap/activity-heatmap.tsx"],
    usage: `"use client";

import { ActivityHeatmap } from "@/components/charts/arc/activity-heatmap/activity-heatmap";

export default function Example() {
  return (
    <ActivityHeatmap label="Conversation activity" period="October 2026" days={[{ date: "2026-10-01", count: 12 }]} />
  );
}`,
  },
  {
    slug: "sparkline",
    kind: "component",
    title: "Sparkline",
    description: "A compact trend with value and change context.",
    group: "Data display",
    preview: "platform",
    variants: ["Default", "Updated data", "Keyboard focus"],
    sources: ["apps/web/src/components/charts/arc/sparkline/sparkline.tsx"],
    usage: `"use client";

import { Sparkline } from "@/components/charts/arc/sparkline/sparkline";

export default function Example() {
  return (
    <Sparkline label="Weekly conversations" data={[26, 38, 31, 47, 58]} />
  );
}`,
  },
  {
    slug: "bump-chart",
    kind: "component",
    title: "Bump chart",
    description: "Rank changes across multiple periods.",
    group: "Data display",
    preview: "platform",
    variants: ["Ranking", "Updated data", "Hover"],
    sources: ["apps/web/src/components/charts/beui/bump-chart.tsx", "apps/web/src/components/charts/beui/motion/tooltip.tsx", "apps/web/src/components/charts/beui/motion/tooltip-surface.tsx"],
    usage: `"use client";

import { BumpChart } from "@/components/charts/beui/bump-chart";

export default function Example() {
  return (
    <BumpChart label="Popular topics" periods={["Week 1", "Week 2"]} series={[{ id: "policy", name: "Policies", ranks: [1, 2] }, { id: "access", name: "Access", ranks: [2, 1] }]} />
  );
}`,
  },
  {
    slug: "chart-container",
    kind: "component",
    title: "Chart container",
    description: "The shared configuration and tooltip adapter for a Recharts chart.",
    group: "Data display",
    preview: "platform",
    variants: ["Chart configuration", "Tooltip", "Theme"],
    sources: ["apps/web/src/components/ui/chart.tsx"],
    usage: `"use client";

import { Bar, BarChart } from "recharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";

export default function Example() {
  return (
    <ChartContainer className="h-52" config={{ count: { label: "Conversations", color: "var(--chart-1)" } }}><BarChart data={[{ count: 42 }]}><ChartTooltip content={<ChartTooltipContent />} /><Bar dataKey="count" fill="var(--color-count)" /></BarChart></ChartContainer>
  );
}`,
  },
  {
    slug: "arc-frame",
    kind: "component",
    title: "Chart frame",
    description: "A local chart theme scope that connects charts to the app’s theme tokens.",
    group: "Data display",
    preview: "platform",
    variants: ["Theme scope", "Custom class"],
    sources: ["apps/web/src/components/charts/arc/arc-frame.tsx"],
    usage: `"use client";

import { ArcFrame } from "@/components/charts/arc/arc-frame";

export default function Example() {
  return (
    <ArcFrame><p>Chart content</p></ArcFrame>
  );
}`,
  },
  {
    slug: "animated-counter",
    kind: "component",
    title: "Animated counter",
    description: "A numeric value that transitions between updates.",
    group: "Data display",
    preview: "platform",
    variants: ["Integer", "Decimals", "Suffix"],
    sources: ["apps/web/src/components/charts/arc/animated-counter/animated-counter.tsx"],
    usage: `"use client";

import { AnimatedCounter } from "@/components/charts/arc/animated-counter/animated-counter";

export default function Example() {
  return (
    <AnimatedCounter value={2468} label="Conversations" />
  );
}`,
  },
  {
    slug: "analytics-card",
    kind: "component",
    title: "Analytics card",
    description: "A chart surface whose caption and controls share one footer.",
    group: "Data display",
    preview: "platform",
    variants: ["Caption", "Action", "Content slot"],
    sources: ["apps/web/src/components/insights/analytics-card.tsx"],
    usage: `"use client";

import { AnalyticsCard } from "@/components/insights/analytics-card";

export default function Example() {
  return (
    <AnalyticsCard title="Conversations" description="Past 30 days"><p>Chart content</p></AnalyticsCard>
  );
}`,
  },
  {
    slug: "dashboard-stat-cards",
    kind: "block",
    title: "Dashboard metrics",
    description: "A complete group of metrics with comparison periods, trends and loading states.",
    group: "Data display",
    preview: "platform",
    variants: ["Metrics", "Comparisons", "Loading"],
    sources: ["apps/web/src/components/insights/dashboard/dashboard-stat-cards.tsx"],
    usage: `"use client";

import { DashboardStatCards } from "@/components/insights/dashboard/dashboard-stat-cards";

export default function Example() {
  return (
    <DashboardStatCards loading={false} specs={[{ key: "conversations", label: "Conversations", kind: "count", value: 2468, previous: 2210, series: [26, 38, 31], labels: ["Mon", "Tue", "Wed"], goodWhen: "up", caption: "Past 30 days" }]} />
  );
}`,
  },
  {
    slug: "radial-gauge",
    kind: "component",
    title: "Radial gauge",
    description: "Concentric SVG rings showing progress across measured windows.",
    group: "Data display",
    preview: "platform",
    variants: ["Single ring", "Multiple rings", "Center content"],
    sources: ["packages/charts/src/radial-gauge.tsx"],
    usage: `"use client";

import { RadialGauge } from "@agent-hub/charts";

export default function Example() {
  return (
    <RadialGauge rings={[{ fraction: 0.72, toneClass: "stroke-primary", label: "Weekly usage: 72%" }]}><span>72%</span></RadialGauge>
  );
}`,
  },
  {
    slug: "message-bubble",
    kind: "component",
    title: "Message bubble",
    description: "One chat bubble with matching content parts.",
    group: "AI & chat",
    preview: "platform",
    variants: ["User", "Assistant"],
    sources: ["apps/web/src/components/agents/message-bubble.tsx"],
    usage: `"use client";

import { Message, MessageBubble, MessageBubbleContent } from "@/components/agents/message";

export default function Example() {
  return (
    <Message from="user"><MessageBubble><MessageBubbleContent>How can I help?</MessageBubbleContent></MessageBubble></Message>
  );
}`,
  },
  {
    slug: "streaming-response",
    kind: "component",
    title: "Streaming response",
    description: "An assistant answer surface with sources, copy and feedback.",
    group: "AI & chat",
    preview: "platform",
    variants: ["Complete", "Loading", "Actions"],
    sources: ["apps/web/src/components/agents/streaming-response.tsx"],
    usage: `"use client";

import { StreamingResponse } from "@/components/agents/streaming-response";

export default function Example() {
  return (
    <StreamingResponse status="complete">How can I help?</StreamingResponse>
  );
}`,
  },
  {
    slug: "chat-markdown",
    kind: "component",
    title: "Chat Markdown",
    description: "The rich-text renderer used for assistant answers and previews.",
    group: "AI & chat",
    preview: "platform",
    variants: ["Headings", "Lists", "Code", "Links"],
    sources: ["apps/web/src/components/chat/chat-markdown.tsx"],
    usage: `"use client";

import { ChatMarkdown } from "@/components/chat/chat-markdown";

export default function Example() {
  return (
    <ChatMarkdown text="**Grounded answers** cite their sources." />
  );
}`,
  },
  {
    slug: "message-scroller",
    kind: "component",
    title: "Message scroller",
    description: "A transcript viewport with pinned scrolling and a message navigation rail.",
    group: "AI & chat",
    preview: "platform",
    variants: ["Rail", "Scroll", "Follow output"],
    sources: ["apps/web/src/components/agents/message-scroller.tsx"],
    usage: `"use client";

import { MessageScroller } from "@/components/agents/message";

export default function Example() {
  return (
    <MessageScroller label="Conversation" navigation="rail" className="h-80"><p>Transcript content</p></MessageScroller>
  );
}`,
  },
  {
    slug: "chat-header",
    kind: "component",
    title: "Chat header",
    description: "A chat’s identity and history, new-chat and fullscreen controls.",
    group: "AI & chat",
    preview: "platform",
    variants: ["History", "New chat", "Fullscreen"],
    sources: ["apps/web/src/components/chat/chat-header.tsx"],
    usage: `"use client";

import { ChatHeader } from "@/components/chat/chat-header";

export default function Example() {
  return (
    <ChatHeader nickname="Ciele" onNewChat={() => {}} />
  );
}`,
  },
  {
    slug: "identity-gate",
    kind: "component",
    title: "Identity gate",
    description: "A sign-in surface with ready, loading and unavailable states.",
    group: "AI & chat",
    preview: "platform",
    variants: ["Ready", "Loading", "Unavailable"],
    sources: ["apps/web/src/components/chat/identity-gate.tsx"],
    usage: `"use client";

import { IdentityGate } from "@/components/chat/identity-gate";

export default function Example() {
  return (
    <div className="relative h-96"><IdentityGate provider="entra" loading={false} onLogin={() => {}} brandColor="var(--brand)" /></div>
  );
}`,
  },
  {
    slug: "composer-pulse",
    kind: "component",
    title: "Composer pulse",
    description: "The visual busy-state wrapper for a prompt composer.",
    group: "AI & chat",
    preview: "platform",
    variants: ["Busy", "Idle"],
    sources: ["apps/web/src/components/chat/composer-pulse.tsx"],
    usage: `"use client";

import { ComposerPulse } from "@/components/chat/composer-pulse";

export default function Example() {
  return (
    <ComposerPulse loading={true}><p>Reviewing the document…</p></ComposerPulse>
  );
}`,
  },
  {
    slug: "command-bar",
    kind: "component",
    title: "Command bar",
    description: "The Flow Canvas text-command entry control.",
    group: "AI & chat",
    preview: "platform",
    variants: ["Submit", "Disabled", "Width"],
    sources: ["apps/web/src/components/assistant/command-bar.tsx"],
    usage: `"use client";

import { CommandBar } from "@/components/assistant/command-bar";

export default function Example() {
  return (
    <CommandBar label="Canvas command" placeholder="Describe a flow…" onSubmit={() => {}} />
  );
}`,
  },
  {
    slug: "trigger-list",
    kind: "component",
    title: "Trigger list",
    description: "Keyboard-selectable suggestions anchored to a composer input.",
    group: "AI & chat",
    preview: "platform",
    variants: ["Highlighted", "Keyboard navigation", "Selection"],
    sources: ["apps/web/src/components/chat/trigger-list.tsx"],
    usage: `"use client";

import { TriggerList } from "@/components/chat/trigger-list";

export default function Example() {
  return (
    <TriggerList id="commands" label="Commands" items={[{ id: "search", label: "Search knowledge" }]} highlighted={0} onHighlight={() => {}} onPick={() => {}} renderItem={(item) => item.label} />
  );
}`,
  },
  {
    slug: "model-source-select",
    kind: "component",
    title: "Model source select",
    description: "One model’s credential-source choice with an automatic fallback.",
    group: "AI & chat",
    preview: "platform",
    variants: ["Automatic", "Platform", "API key"],
    sources: ["apps/web/src/components/chat/model-source-select.tsx"],
    usage: `"use client";

import { ModelSourceSelect } from "@/components/chat/model-source-select";

export default function Example() {
  return (
    <ModelSourceSelect sources={["platform", "api_key"]} value={null} onChange={() => {}} />
  );
}`,
  },
  {
    slug: "model-allow-list",
    kind: "component",
    title: "Model allow list",
    description: "The models offered to a person while composing a message.",
    group: "AI & chat",
    preview: "platform",
    variants: ["Configured model", "Additional models", "Remove model"],
    sources: ["apps/web/src/components/chat/model-allow-list.tsx"],
    usage: `"use client";

import { ModelAllowList } from "@/components/chat/model-allow-list";

export default function Example() {
  return (
    <ModelAllowList configured={{ provider: "google", modelId: "gemini-2.5-flash" }} value={[]} onChange={() => {}} sources={{}} />
  );
}`,
  },
  {
    slug: "citation-stack",
    kind: "component",
    title: "Citation stack",
    description: "A compact overlap of source marks beside a source summary.",
    group: "AI & chat",
    preview: "platform",
    variants: ["Single source", "Multiple sources", "Limit"],
    sources: ["apps/web/src/components/agents/citations.tsx"],
    usage: `"use client";

import { CitationStack } from "@/components/agents/citations";

export default function Example() {
  return (
    <CitationStack citations={[{ id: "policy", title: "Account policy" }]} />
  );
}`,
  },
  {
    slug: "citation-list",
    kind: "component",
    title: "Citation list",
    description: "Named source rows with document or external-link presentation.",
    group: "AI & chat",
    preview: "platform",
    variants: ["Rows", "Named sources", "Document references"],
    sources: ["apps/web/src/components/agents/citations.tsx"],
    usage: `"use client";

import { CitationList } from "@/components/agents/citations";

export default function Example() {
  return (
    <CitationList citations={[{ id: "policy", title: "Account policy", domain: "Knowledge" }]} />
  );
}`,
  },
  {
    slug: "inline-citation",
    kind: "component",
    title: "Inline citation",
    description: "An inline source marker with a hover or focus preview.",
    group: "AI & chat",
    preview: "platform",
    variants: ["Hover", "Focus", "Preview"],
    sources: ["apps/web/src/components/smoothui/ai-citation/index.tsx"],
    usage: `"use client";

import AICitation from "@/components/smoothui/ai-citation";

export default function Example() {
  return (
    <p>Admins manage settings. <AICitation label={1} title="Account policy" description="Organization role permissions." /></p>
  );
}`,
  },
  {
    slug: "thinking-timeline",
    kind: "component",
    title: "Thinking timeline",
    description: "One turn’s ordered tool calls, thoughts and plan stages.",
    group: "AI & chat",
    preview: "platform",
    variants: ["Tools", "Thoughts", "Plan stages"],
    sources: ["apps/web/src/components/chat/thinking-timeline.tsx"],
    usage: `"use client";

import { ThinkingTimeline } from "@/components/chat/thinking-timeline";

export default function Example() {
  return (
    <ThinkingTimeline steps={[{ id: "search", kind: "tool", tool: "searchKnowledge", label: "Searching knowledge", status: "done" }]} />
  );
}`,
  },
  {
    slug: "thinking-orb",
    kind: "component",
    title: "Thinking orb",
    description: "A small animated state mark for active assistant work.",
    group: "AI & chat",
    preview: "platform",
    variants: ["Working", "Searching", "Solving", "Connecting"],
    sources: ["apps/web/src/components/orbs/thinking-orb.tsx"],
    usage: `"use client";

import { ThinkingOrb } from "@/components/orbs/thinking-orb";

export default function Example() {
  return (
    <span><ThinkingOrb state="searching" /> Searching knowledge</span>
  );
}`,
  },
  {
    slug: "thinking-shimmer",
    kind: "component",
    title: "Thinking shimmer",
    description: "The label presentation used while a reasoning segment is active.",
    group: "AI & chat",
    preview: "platform",
    variants: ["Active", "Reduced motion"],
    sources: ["apps/web/src/components/agents/loading-states/thinking-shimmer.tsx"],
    usage: `"use client";

import { ThinkingShimmer } from "@/components/agents/loading-states/thinking-shimmer";

export default function Example() {
  return (
    <ThinkingShimmer>Thinking…</ThinkingShimmer>
  );
}`,
  },
  {
    slug: "progress-line",
    kind: "component",
    title: "Progress line",
    description: "A single student-readable line describing the current work.",
    group: "AI & chat",
    preview: "platform",
    variants: ["Text update", "Reduced motion"],
    sources: ["apps/web/src/components/chat/progress-line.tsx"],
    usage: `"use client";

import { ProgressLine } from "@/components/chat/progress-line";

export default function Example() {
  return (
    <ProgressLine text="I’m checking the invitation steps." />
  );
}`,
  },
  {
    slug: "agent-activity",
    kind: "component",
    title: "Agent activity",
    description: "A collapsible reasoning segment with active and completed states.",
    group: "AI & chat",
    preview: "platform",
    variants: ["Working", "Complete", "Duration"],
    sources: ["apps/web/src/components/agents/agent-activity/index.tsx"],
    usage: `"use client";

import { AgentActivity } from "@/components/agents/agent-activity";

export default function Example() {
  return (
    <AgentActivity items={[{ id: "sample", type: "text", content: "Checking the source." }]} status="complete" duration={2} />
  );
}`,
  },
  {
    slug: "tool-approval",
    kind: "component",
    title: "Tool approval",
    description: "A tool operation’s pending, approved or denied decision control.",
    group: "AI & chat",
    preview: "platform",
    variants: ["Pending", "Approving", "Approved", "Denied"],
    sources: ["apps/web/src/components/agents/tool-approval.tsx"],
    usage: `"use client";

import { ToolApproval } from "@/components/agents/tool-approval";

export default function Example() {
  return (
    <ToolApproval tool="members.invite" description="Invite a teammate." status="pending" onApprove={() => {}} onDeny={() => {}} />
  );
}`,
  },
  {
    slug: "agent-disclosure",
    kind: "component",
    title: "Agent disclosure",
    description: "A shared reveal surface for collapsible agent content.",
    group: "AI & chat",
    preview: "platform",
    variants: ["Open", "Closed", "Reduced motion"],
    sources: ["apps/web/src/components/agents/agent-disclosure.tsx"],
    usage: `"use client";

import { AgentDisclosure } from "@/components/agents/agent-disclosure";

export default function Example() {
  return (
    <AgentDisclosure open={true}><p>Tool output</p></AgentDisclosure>
  );
}`,
  },
  {
    slug: "attachment-drop-hint",
    kind: "component",
    title: "Attachment drop hint",
    description: "The transient target hint shown while a file is above the composer.",
    group: "AI & chat",
    preview: "platform",
    variants: ["Visible", "Theme"],
    sources: ["apps/web/src/components/chat/attachment-chips.tsx"],
    usage: `"use client";

import { AttachmentDropHint } from "@/components/chat/attachment-chips";

export default function Example() {
  return (
    <div className="relative h-24"><AttachmentDropHint label="Drop files to attach them" /></div>
  );
}`,
  },
  {
    slug: "reaction-record",
    kind: "component",
    title: "Reaction record",
    description: "A transcript summary of the people who reacted to a message.",
    group: "AI & chat",
    preview: "platform",
    variants: ["People", "Multiple emoji", "Empty"],
    sources: ["apps/web/src/components/chat/reaction-record.tsx", "apps/web/src/components/chat/message-reactions.tsx"],
    usage: `"use client";

import { ReactionRecord } from "@/components/chat/reaction-record";

export default function Example() {
  return (
    <ReactionRecord reactions={[{ organizationId: "sample", messageId: "sample", channelMessageId: null, actorId: "alex", actorName: "Alex", emoji: "🙌" }]} />
  );
}`,
  },
  {
    slug: "emoji-picker",
    kind: "component",
    title: "Emoji picker",
    description: "A searchable palette of emoji with selected and disabled states.",
    group: "AI & chat",
    preview: "platform",
    variants: ["Selection", "Search", "Disabled"],
    sources: ["apps/web/src/components/chat/emoji-picker.tsx"],
    usage: `"use client";

import EmojiPicker from "@/components/chat/emoji-picker";

export default function Example() {
  return (
    <EmojiPicker selected={[]} disabled={false} onBack={() => {}} onSelect={() => {}} />
  );
}`,
  },
  {
    slug: "study-menu",
    kind: "component",
    title: "Study menu",
    description: "The format-choice menu that inserts a study command in a composer.",
    group: "AI & chat",
    preview: "platform",
    variants: ["Multiple choice", "Drag words", "True / false", "Flashcards"],
    sources: ["apps/web/src/components/chat/study-menu.tsx"],
    usage: `"use client";

import { StudyMenu } from "@/components/chat/study-menu";

export default function Example() {
  return (
    <StudyMenu settings={{ enabled: true, formats: ["multiple_choice", "flashcards"], instructions: "" }} onSelect={() => {}} />
  );
}`,
  },
  {
    slug: "toasts",
    kind: "component",
    title: "Toasts",
    description: "Transient success, error, warning and informational feedback.",
    group: "Surfaces",
    preview: "platform",
    variants: ["Success", "Error", "Warning", "Info"],
    sources: ["apps/web/src/components/notifications/toasts.tsx"],
    usage: `"use client";

import { toast } from "@/lib/toast";
import { Button } from "@agent-hub/ui";

export default function Example() {
  return (
    <Button onClick={() => toast.success("Changes saved")}>Save sample</Button>
  );
}`,
  },
  {
    slug: "reply-components",
    kind: "block",
    title: "Generated reply",
    description: "Runtime-generated tables and study results inside the shared chat reply contract.",
    group: "AI & chat",
    preview: "platform",
    variants: ["Table", "Follow-up", "Study result"],
    sources: ["apps/web/src/components/chat/component-part.tsx", "apps/web/src/components/chat/study-exercise.tsx"],
    usage: `"use client";

import { ComponentReplyPart } from "@/components/chat/component-part";

export default function Example() {
  return (
    <ComponentReplyPart part={{ type: "component", action: "search_knowledge", name: "table", callId: "sample", props: { title: "Roles", columns: ["Role", "Access"], rows: [["Admin", "Settings"]] } }} />
  );
}`,
  },
  {
    slug: "conversation",
    kind: "block",
    title: "Conversation",
    description: "A complete chat transcript that connects header, messages, answers, sources and feedback.",
    group: "AI & chat",
    preview: "platform",
    variants: ["History", "Messages", "Source feedback", "Fullscreen"],
    sources: ["apps/web/src/components/chat/chat-header.tsx", "apps/web/src/components/agents/message.tsx", "apps/web/src/components/agents/message-scroller.tsx", "apps/web/src/components/agents/streaming-response.tsx", "apps/web/src/components/chat/chat-markdown.tsx", "apps/web/src/components/chat/feedback-dialog.tsx"],
    usage: `"use client";

import { Message, MessageContent, MessageScroller } from "@/components/agents/message";
import { ChatHeader } from "@/components/chat/chat-header";

export default function Example() {
  return (
    <div><ChatHeader nickname="Ciele" onNewChat={() => {}} /><MessageScroller label="Conversation" className="h-80"><Message from="assistant"><MessageContent>How can I help?</MessageContent></Message></MessageScroller></div>
  );
}`,
  },
  {
    slug: "model-configuration",
    kind: "block",
    title: "Model configuration",
    description: "A configured model, credential source and composer allow-list in one connected form.",
    group: "Forms",
    preview: "platform",
    variants: ["Source", "Allowed models", "Automatic"],
    sources: ["apps/web/src/components/chat/model-source-select.tsx", "apps/web/src/components/chat/model-allow-list.tsx"],
    usage: `"use client";

import { ModelSourceSelect } from "@/components/chat/model-source-select";
import { ModelAllowList } from "@/components/chat/model-allow-list";

export default function Example() {
  return (
    <div><ModelSourceSelect sources={["platform", "api_key"]} value={null} onChange={() => {}} /><ModelAllowList configured={{ provider: "google", modelId: "gemini-2.5-flash" }} value={[]} onChange={() => {}} sources={{}} /></div>
  );
}`,
  },
  {
    slug: "canvas-toolbar",
    kind: "component",
    title: "Canvas toolbar",
    description: "The canvas’s tool, add-step and zoom controls.",
    group: "Forms",
    preview: "platform",
    variants: ["Select", "Pan", "Step picker", "Zoom", "Fit"],
    sources: ["apps/web/src/components/assistant/canvas-toolbar.tsx"],
    usage: `"use client";

import { CanvasToolbar } from "@/components/assistant/canvas-toolbar";

export default function Example() {
  return (
    <CanvasToolbar tool="select" onToolChange={() => {}} pickerOpen={false} onPickerOpenChange={() => {}} picker={null} readOnly={false} onFit={() => {}} onZoomIn={() => {}} onZoomOut={() => {}} controls={[]} />
  );
}`,
  },
  {
    slug: "radial-menu",
    kind: "component",
    title: "Radial menu",
    description: "A compact fan of canvas commands with pointer and keyboard selection.",
    group: "Navigation",
    preview: "platform",
    variants: ["Open", "Gesture selection", "Keyboard"],
    sources: ["apps/web/src/components/assistant/radial-menu.tsx"],
    usage: `"use client";

import { Rows3 } from "lucide-react";
import { RadialMenu } from "@/components/assistant/radial-menu";

export default function Example() {
  return (
    <RadialMenu actions={[{ label: "Auto layout", icon: Rows3, run: () => {} }]} onOpen={() => {}} />
  );
}`,
  },
  {
    slug: "flow-canvas-field",
    kind: "component",
    title: "Canvas field",
    description: "The graph backdrop rendered inside its canvas root.",
    group: "Motion",
    preview: "platform",
    variants: ["Theme", "Pointer field"],
    sources: ["apps/web/src/components/assistant/flow-canvas-field.tsx"],
    usage: `"use client";

import { useRef } from "react";
import { ReactFlowProvider } from "@xyflow/react";
import { FlowCanvasField } from "@/components/assistant/flow-canvas-field";

export default function Example() {
  const root = useRef<HTMLDivElement>(null);

  return (
    <ReactFlowProvider><div ref={root} className="relative h-96"><FlowCanvasField root={root} themeKey="sample" /></div></ReactFlowProvider>
  );
}`,
  },
  {
    slug: "markdown-editor",
    kind: "block",
    title: "Markdown editor",
    description: "A connected Markdown draft and rendered answer preview.",
    group: "Forms",
    preview: "platform",
    variants: ["Draft", "Live preview"],
    sources: ["apps/web/src/components/ui/textarea.tsx", "apps/web/src/components/chat/chat-markdown.tsx"],
    usage: `"use client";

import { useState } from "react";
import { Textarea } from "@/components/ui/textarea";
import { ChatMarkdown } from "@/components/chat/chat-markdown";

export default function Example() {
  const [draft, setDraft] = useState("## Answering style");

  return (
    <div><Textarea aria-label="Draft" value={draft} onChange={(event) => setDraft(event.target.value)} /><ChatMarkdown text={draft} /></div>
  );
}`,
  },
  {
    slug: "nav-tree",
    kind: "component",
    title: "Navigation tree",
    description: "A compact section navigation with one active destination.",
    group: "Navigation",
    preview: "platform",
    variants: ["Active", "Inactive", "Nested"],
    sources: ["apps/web/src/components/shell/nav-tree.tsx"],
    usage: `"use client";

import { Folder } from "lucide-react";
import { NavTree } from "@/components/shell/nav-tree";

export default function Example() {
  return (
    <NavTree label="Sections" activeIndex={0} items={[{ label: "Knowledge", href: "/components/file-tree", icon: Folder }]} />
  );
}`,
  },
  {
    slug: "find-row",
    kind: "component",
    title: "Search result row",
    description: "One selectable search result with its icon, label and metadata.",
    group: "Navigation",
    preview: "platform",
    variants: ["Active", "Inactive", "Select"],
    sources: ["apps/web/src/components/shell/find-row.tsx"],
    usage: `"use client";

import { Folder } from "lucide-react";
import { FindRow } from "@/components/shell/find-row";

export default function Example() {
  return (
    <FindRow item={{ key: "knowledge", label: "Knowledge", hint: "Workspace", group: "Pages", icon: Folder, href: "/components/file-tree", record: null }} index={0} optionId="knowledge-result" isActive={true} onMove={() => {}} onSelect={() => {}} />
  );
}`,
  },
  {
    slug: "intent-link",
    kind: "component",
    title: "Intent link",
    description: "The app link wrapper that preserves the user’s navigation intent.",
    group: "Navigation",
    preview: "platform",
    variants: ["Default", "Modified click"],
    sources: ["apps/web/src/components/ui/intent-link.tsx"],
    usage: `"use client";

import { IntentLink } from "@/components/ui/intent-link";

export default function Example() {
  return (
    <IntentLink href="/components/labels">View labels</IntentLink>
  );
}`,
  },
  {
    slug: "quick-search",
    kind: "block",
    title: "Quick search",
    description: "A keyboard-navigable search field with selectable result rows.",
    group: "Navigation",
    preview: "platform",
    variants: ["Arrow keys", "Selection", "Input"],
    sources: ["apps/web/src/components/shell/find-row.tsx"],
    usage: `"use client";

import { Folder } from "lucide-react";
import { Input } from "@agent-hub/ui";
import { FindRow } from "@/components/shell/find-row";

export default function Example() {
  return (
    <div><Input aria-label="Search pages" aria-controls="results" aria-activedescendant="knowledge" /><div id="results" role="listbox" aria-label="Results"><FindRow item={{ key: "knowledge", label: "Knowledge", hint: "Workspace", group: "Pages", icon: Folder, href: "/components/file-tree", record: null }} index={0} optionId="knowledge" isActive={true} onMove={() => {}} onSelect={() => {}} /></div></div>
  );
}`,
    notes: "The preview supplies a local result list and active-descendant keyboard integration; the shell supplies the live search data.",
  },
  {
    slug: "settings-sections",
    kind: "block",
    title: "Settings sections",
    description: "A complete settings form with group navigation, field hints, a toggle and a local save action.",
    group: "Forms",
    preview: "platform",
    variants: ["Group navigation", "Fields", "Toggle", "Save"],
    sources: ["apps/web/src/components/settings/section-timeline.tsx", "apps/web/src/components/settings/field-header.tsx", "apps/web/src/components/ui/motion-switch.tsx"],
    usage: `"use client";

import { SectionTimeline, TimelineSection } from "@/components/settings/section-timeline";

export default function Example() {
  return (
    <SectionTimeline><TimelineSection title="General"><p>General settings</p></TimelineSection><TimelineSection title="Advanced"><p>Advanced settings</p></TimelineSection></SectionTimeline>
  );
}`,
  },
  {
    slug: "marketing-navigation",
    kind: "block",
    title: "Marketing navigation",
    description: "The site’s complete desktop navigation and expandable feature menu.",
    group: "Navigation",
    preview: "platform",
    variants: ["Desktop", "Feature menu", "Scrolled"],
    sources: ["apps/web/src/components/home/motion-navigation-menu.tsx"],
    usage: `"use client";

import { MotionNavigationMenu } from "@/components/home/motion-navigation-menu";

export default function Example() {
  return (
    <MotionNavigationMenu scrolled={false} />
  );
}`,
  },
  {
    slug: "app-brand",
    kind: "component",
    title: "Application brand",
    description: "Connector marks keyed by the application provider.",
    group: "Foundations",
    preview: "platform",
    variants: ["Connector marks", "Sizes"],
    sources: ["apps/web/src/components/ui/app-brand.tsx"],
    usage: `"use client";

import { AppBrandMark } from "@/components/ui/app-brand";

export default function Example() {
  return (
    <AppBrandMark provider="google_drive" />
  );
}`,
  },
  {
    slug: "provider-brand-icon",
    kind: "component",
    title: "Provider brand icon",
    description: "The provider-connection identity used in settings.",
    group: "Foundations",
    preview: "platform",
    variants: ["Anthropic", "OpenAI", "Google", "Azure", "ElevenLabs"],
    sources: ["apps/web/src/components/settings/provider-brand-icon.tsx"],
    usage: `"use client";

import { ProviderBrandIcon } from "@/components/settings/provider-brand-icon";

export default function Example() {
  return (
    <ProviderBrandIcon provider="google" />
  );
}`,
  },
  {
    slug: "model-provider-logo",
    kind: "component",
    title: "Model provider logo",
    description: "The compact provider identity used by composer model choices.",
    group: "Foundations",
    preview: "platform",
    variants: ["Anthropic", "OpenAI", "Google", "Compatible"],
    sources: ["apps/web/src/components/chat/model-provider-logo.tsx"],
    usage: `"use client";

import { ModelProviderLogo } from "@/components/chat/model-provider-logo";

export default function Example() {
  return (
    <ModelProviderLogo provider="google" />
  );
}`,
  },
  {
    slug: "github-mark",
    kind: "component",
    title: "GitHub mark",
    description: "A monochrome GitHub identity glyph for website links.",
    group: "Foundations",
    preview: "platform",
    variants: ["Default", "Size"],
    sources: ["apps/web/src/components/home/github-mark.tsx"],
    usage: `"use client";

import { GithubMark } from "@/components/home/github-mark";

export default function Example() {
  return (
    <GithubMark className="size-6" />
  );
}`,
  },
  {
    slug: "ghost-mark",
    kind: "component",
    title: "Ghost mark",
    description: "The illustrated Ciele ghost identity used by authentication surfaces.",
    group: "Foundations",
    preview: "platform",
    variants: ["Default", "Size"],
    sources: ["apps/web/src/components/auth/ghost-mark.tsx"],
    usage: `"use client";

import { GhostMark } from "@/components/auth/ghost-mark";

export default function Example() {
  return (
    <GhostMark className="size-14" />
  );
}`,
  },
  {
    slug: "transcript-citations",
    kind: "component",
    title: "Transcript citations",
    description: "Expandable source chips with concept, collection and original-source metadata.",
    group: "AI & chat",
    preview: "platform",
    variants: ["Collapsed", "Expanded", "Source metadata"],
    sources: ["apps/web/src/components/chat/citation-list.tsx"],
    usage: `"use client";

import { CitationList } from "@/components/chat/citation-list";

export default function Example() {
  return (
    <CitationList sources={[{ conceptTitle: "Account policy", collectionName: "Knowledge", sourceName: "Policy document" }]} collapsible />
  );
}`,
  },
  {
    slug: "ciele-ai-peek",
    kind: "component",
    title: "Ciele AI peek",
    description: "The contextual Ciele mark that peeks from a hovered or focused action.",
    group: "Foundations",
    preview: "platform",
    variants: ["Rest", "Hover", "Focus"],
    sources: ["apps/web/src/components/teammates/ciele-ai-logo.tsx"],
    usage: `"use client";

import { Button } from "@agent-hub/ui";
import { CieleAiPeek } from "@/components/teammates/ciele-ai-logo";

export default function Example() {
  return (
    <Button className="group relative overflow-hidden pr-16">New chat<CieleAiPeek className="absolute -bottom-3 right-2" /></Button>
  );
}`,
  },
  {
    slug: "voice-input",
    kind: "component",
    title: "Voice input",
    description: "A recording control that submits audio to a configured transcription endpoint.",
    group: "AI & chat",
    preview: "platform",
    variants: ["Unavailable endpoint", "Disabled"],
    sources: ["apps/web/src/components/chat/voice-input-button.tsx"],
    usage: `"use client";

import { VoiceInputButton } from "@/components/chat/voice-input-button";

export default function Example() {
  return (
    <VoiceInputButton endpoint="/api/voice/transcribe" disabled onTranscript={() => {}} onBusyChange={() => {}} onStreamChange={() => {}} />
  );
}`,
    notes: "The preview demonstrates the disabled control. Recording, transcription and permission states require a configured endpoint and a deliberate microphone request; no permission request is made here.",
  },
  {
    slug: "speech-playback",
    kind: "component",
    title: "Speech playback",
    description: "An answer’s read-aloud control with playback, pause and cancellation.",
    group: "AI & chat",
    preview: "platform",
    variants: ["Idle", "Loading", "Playing", "Pause"],
    sources: ["apps/web/src/components/chat/speech-playback.tsx"],
    usage: `"use client";

import { SpeechPlayback } from "@/components/chat/speech-playback";

export default function Example() {
  return (
    <SpeechPlayback endpoint="/api/voice/synthesize" text="Sample response." />
  );
}`,
    notes: "The preview plays a bundled local speech sample through a data URL, with no synthesis endpoint request. Service-backed synthesis requires the configured endpoint in the usage example.",
  },
  {
    slug: "activity",
    kind: "block",
    title: "Activity",
    description: "The complete Overview activity card, with three metrics, sparklines, deltas and its destination.",
    group: "Overview",
    preview: "block",
    variants: ["Activity", "Empty", "Loading"],
    sources: ["apps/web/src/components/assistant/overview-blocks.tsx", "apps/web/src/components/insights/dashboard/dashboard-stat-cards.tsx", "apps/web/src/lib/insights/dashboard-stats.ts"],
    usage: `"use client";

import type { UsageDashboard } from "@agent-hub/core";
import { OverviewActivity } from "@/components/assistant/overview-blocks";

export default function Example({ dashboard }: { dashboard: UsageDashboard }) {
  return <div className="assistant-overview"><OverviewActivity activity={dashboard} previousActivity={null} href="/insights/observability" /></div>;
}`,
    notes: "This is one autonomous block used by AssistantOverview. Keep the assistant-overview wrapper for its frame and inset tokens. Pass totals for the previous equal-length period to show deltas.",
  },
  {
    slug: "setup-checklist",
    kind: "block",
    title: "Setup checklist",
    description: "Setup steps, completion marks, progress and a link to the next unfinished step.",
    group: "Overview",
    preview: "block",
    variants: ["In progress", "Not started", "Complete"],
    sources: ["apps/web/src/components/assistant/overview-blocks.tsx"],
    usage: `"use client";

import { OverviewChecklist } from "@/components/assistant/overview-blocks";

export default function Example() {
  return <div className="assistant-overview"><OverviewChecklist steps={[
    { label: "Add knowledge sources", section: "Knowledge", href: "/library", done: false },
    { label: "Create a flow", section: "Flows", href: "/assistants", done: true },
    { label: "Publish the widget", section: "Publish", href: "/assistants", done: true },
  ]} /></div>;
}`,
    notes: "The completed checklist disappears, exactly as it does in Overview. Its caption points to the first unfinished step.",
  },
  {
    slug: "quality",
    kind: "block",
    title: "Quality",
    description: "Quality rings, supporting counts, prior-period comparisons and estimated spend in one card.",
    group: "Overview",
    preview: "block",
    variants: ["Reliability, accuracy & autonomy", "No activity"],
    sources: ["apps/web/src/components/assistant/overview-blocks.tsx", "apps/web/src/lib/assistant-overview.ts"],
    usage: `"use client";

import type { UsageDashboard } from "@agent-hub/core";
import { OverviewQuality } from "@/components/assistant/overview-blocks";

export default function Example({ dashboard }: { dashboard: UsageDashboard }) {
  return <div className="assistant-overview"><OverviewQuality totals={dashboard.totals} previous={null} href="/insights/observability" costsHref="/insights/costs" /></div>;
}`,
    notes: "Hover or focus each rate to inspect its underlying counts. The default period is the Overview’s seven-day window.",
  },
  {
    slug: "flow-list",
    kind: "block",
    title: "Flow list",
    description: "Routing order, built-in and default markers, enabled states and the destination in one Overview block.",
    group: "Overview",
    preview: "block",
    variants: ["Populated", "Empty"],
    sources: ["apps/web/src/components/assistant/overview-resource-blocks.tsx", "apps/web/src/components/assistant/overview-blocks.tsx", "apps/web/src/lib/assistant-overview.ts"],
    usage: `"use client";

import type { Flow } from "@agent-hub/core";
import { OverviewFlows } from "@/components/assistant/overview-resource-blocks";

export default function Example({ flows }: { flows: Flow[] }) {
  return <div className="assistant-overview"><OverviewFlows flows={flows} base="/assistants/my-assistant" /></div>;
}`,
    notes: "The same list used in AssistantOverview, showing up to six flows. Default behavior remains last.",
  },
  {
    slug: "knowledge-list",
    kind: "block",
    title: "Knowledge list",
    description: "Source icons, ingestion states, relative timestamps and collection totals within an Overview card.",
    group: "Overview",
    preview: "block",
    variants: ["Populated", "Empty"],
    sources: ["apps/web/src/components/assistant/overview-resource-blocks.tsx", "apps/web/src/components/assistant/overview-blocks.tsx", "apps/web/src/components/knowledge/source-status-badge.tsx"],
    usage: `"use client";

import { OverviewKnowledge, type OverviewSource } from "@/components/assistant/overview-resource-blocks";

export default function Example({ sources }: { sources: OverviewSource[] }) {
  return <div className="assistant-overview"><OverviewKnowledge sources={sources} sourceCount={sources.length} collectionCount={1} base="/assistants/my-assistant" now={new Date().toISOString()} /></div>;
}`,
    notes: "A complete list composition used by AssistantOverview. In production, pass the server’s timestamp to keep relative labels consistent during hydration.",
  },
  {
    slug: "conversation-list",
    kind: "block",
    title: "Conversation list",
    description: "Recent conversation titles, visitor identities, flow badges, ratings, counts and timestamps.",
    group: "Overview",
    preview: "block",
    variants: ["Populated", "Empty"],
    sources: ["apps/web/src/components/assistant/overview-resource-blocks.tsx", "apps/web/src/components/assistant/overview-blocks.tsx", "apps/web/src/lib/inbox/conversation-filter.ts"],
    usage: `"use client";

import { OverviewConversations, type OverviewConversation } from "@/components/assistant/overview-resource-blocks";

export default function Example({ conversations }: { conversations: OverviewConversation[] }) {
  return <div className="assistant-overview"><OverviewConversations conversations={conversations} assistantId="my-assistant" now={new Date().toISOString()} /></div>;
}`,
    notes: "This block is reused directly in AssistantOverview. Conversation links lead to the Inbox record; the caption leads to the assistant’s filtered Inbox.",
  },
  {
    slug: "metric-grid",
    kind: "block",
    title: "Metric grid",
    description: "A responsive group of related dashboard metrics, with sparklines, context and comparisons.",
    group: "Analytics",
    preview: "block",
    variants: ["Activity", "Costs", "Observability", "Empty", "Loading"],
    sources: ["apps/web/src/components/insights/dashboard/dashboard-stat-cards.tsx", "apps/web/src/lib/insights/dashboard-stats.ts"],
    usage: `"use client";

import type { UsageDashboard } from "@agent-hub/core";
import { DashboardStatCards } from "@/components/insights/dashboard/dashboard-stat-cards";
import { costStats } from "@/lib/insights/dashboard-stats";

export default function Example({ dashboard }: { dashboard: UsageDashboard }) {
  return <DashboardStatCards specs={costStats(dashboard, null)} loading={false} />;
}`,
    notes: "One metric grid is a block; individual metrics remain in Metric cards. Activity, Costs and Observability are variations of the same grid role.",
  },
  {
    slug: "usage",
    kind: "block",
    title: "Usage",
    description: "The complete Insights chart: metrics, assistant and channel breakdowns, legends, zoom and a data table.",
    group: "Analytics",
    preview: "block",
    variants: ["Metrics", "Assistants", "Channels", "Data table", "Empty"],
    sources: ["apps/web/src/components/insights/insights-chart.tsx", "apps/web/src/components/insights/analytics-card.tsx", "apps/web/src/components/insights/analytics-card.module.css"],
    usage: `"use client";

import { UsageCard } from "@/components/insights/insights-chart";

export default function Example() {
  return <UsageCard labels={["2026-09-01", "2026-09-02", "2026-09-03"]}
    metrics={[{ key: "Conversations", color: "var(--chart-1)", values: [24, 38, 31] }]}
    assistants={[]} channels={[]} defaultVisibleMetrics={["Conversations"]} fetchedAt={Date.now()} />;
}`,
    notes: "The chart, breakdown controls, caption and table form a single Usage block. Toggle a legend row, select a brush range or open the data table.",
  },
  {
    slug: "conversation-depth",
    kind: "block",
    title: "Conversation depth",
    description: "Conversation duration and questions per conversation, with separate axes and summary statistics.",
    group: "Analytics",
    preview: "block",
    variants: ["Populated", "Empty"],
    sources: ["apps/web/src/components/insights/conversation-depth-card.tsx", "apps/web/src/components/insights/analytics-card.tsx", "apps/web/src/components/insights/analytics-card.module.css"],
    usage: `"use client";

import { ConversationDepthCard } from "@/components/insights/conversation-depth-card";

export default function Example() {
  return <ConversationDepthCard labels={["2026-09-01", "2026-09-02", "2026-09-03"]}
    series={[{ key: "Avg. conversation time", values: [90, 120, 150] }, { key: "Questions / Conversation", values: [2, 3, 4] }]}
    avgConversationSeconds={120} questionsPerConversation={3} />;
}`,
    notes: "Reuses the complete Insights composition, including the inset chart and caption. Duration and question counts keep their own scales.",
  },
  {
    slug: "spend-trend",
    kind: "block",
    title: "Spend trend",
    description: "Daily estimated spend, chart interactions and a caption identifying the selected surface.",
    group: "Analytics",
    preview: "block",
    variants: ["All surfaces", "Assistants", "Teammates", "Empty"],
    sources: ["apps/web/src/components/insights/dashboard/dashboard-blocks.tsx", "apps/web/src/components/insights/analytics-card.tsx", "apps/web/src/components/insights/analytics-card.module.css", "apps/web/src/components/insights/dashboard/dashboard-bars.tsx"],
    usage: `"use client";

import type { UsageDashboard } from "@agent-hub/core";
import { SpendTrendCard } from "@/components/insights/dashboard/dashboard-blocks";

export default function Example({ dashboard }: { dashboard: UsageDashboard }) {
  return <SpendTrendCard daily={dashboard.daily} />;
}`,
    notes: "This autonomous composition is reused directly in the admin dashboard. The preview uses local sample data; source code contains the production component and its chart dependencies.",
  },
  {
    slug: "token-activity",
    kind: "block",
    title: "Token activity",
    description: "An input-token share gauge and token heat calendar with peak-day, daily-average and weekday summaries.",
    group: "Analytics",
    preview: "block",
    variants: ["Populated", "Empty"],
    sources: ["apps/web/src/components/usage-gauge.tsx", "apps/web/src/components/insights/dashboard/dashboard-blocks.tsx", "apps/web/src/components/insights/analytics-card.tsx", "apps/web/src/components/insights/analytics-card.module.css", "apps/web/src/components/insights/dashboard/dashboard-animated.tsx", "apps/web/src/lib/insights/dashboard-view.ts"],
    usage: `"use client";

import type { UsageDashboard } from "@agent-hub/core";
import { TokenActivityCard } from "@/components/insights/dashboard/dashboard-blocks";

export default function Example({ dashboard }: { dashboard: UsageDashboard }) {
  return <TokenActivityCard daily={dashboard.daily} totals={dashboard.totals} />;
}`,
    notes: "This autonomous composition is reused directly in the admin dashboard. The preview uses local sample data; source code contains the production component and its chart dependencies.",
  },
  {
    slug: "spend-composition",
    kind: "block",
    title: "Spend composition",
    description: "Daily spend mix with surface colors, totals, shares, calls and token counts.",
    group: "Analytics",
    preview: "block",
    variants: ["Populated", "Empty"],
    sources: ["apps/web/src/components/insights/dashboard/dashboard-blocks.tsx", "apps/web/src/components/insights/analytics-card.tsx", "apps/web/src/components/insights/analytics-card.module.css", "apps/web/src/components/insights/dashboard/dashboard-animated.tsx"],
    usage: `"use client";

import type { UsageDashboard } from "@agent-hub/core";
import { SurfaceSpendCard } from "@/components/insights/dashboard/dashboard-blocks";

export default function Example({ dashboard }: { dashboard: UsageDashboard }) {
  return <SurfaceSpendCard daily={dashboard.daily} surfaces={dashboard.surfaces} />;
}`,
    notes: "This autonomous composition is reused directly in the admin dashboard. The preview uses local sample data; source code contains the production component and its chart dependencies.",
  },
  {
    slug: "model-spend",
    kind: "block",
    title: "Model spend",
    description: "A provider-to-model treemap with drill-down, contextual totals and its card caption.",
    group: "Analytics",
    preview: "block",
    variants: ["Providers", "Model drill-down", "Empty"],
    sources: ["apps/web/src/components/insights/dashboard/dashboard-blocks.tsx", "apps/web/src/components/insights/analytics-card.tsx", "apps/web/src/components/insights/analytics-card.module.css", "apps/web/src/components/insights/dashboard/dashboard-comparisons.tsx"],
    usage: `"use client";

import type { UsageDashboard } from "@agent-hub/core";
import { ModelSpendCard } from "@/components/insights/dashboard/dashboard-blocks";

export default function Example({ dashboard }: { dashboard: UsageDashboard }) {
  return <ModelSpendCard models={dashboard.models} />;
}`,
    notes: "This autonomous composition is reused directly in the admin dashboard. The preview uses local sample data; source code contains the production component and its chart dependencies.",
  },
  {
    slug: "model-usage",
    kind: "block",
    title: "Model usage",
    description: "The full model table, including provider, spend, calls, input/output tokens and share bars.",
    group: "Analytics",
    preview: "block",
    variants: ["Populated", "Empty"],
    sources: ["apps/web/src/components/insights/dashboard/dashboard-blocks.tsx", "apps/web/src/components/insights/analytics-card.tsx", "apps/web/src/components/insights/analytics-card.module.css", "apps/web/src/components/ui/table.tsx"],
    usage: `"use client";

import type { UsageDashboard } from "@agent-hub/core";
import { ModelUsageCard } from "@/components/insights/dashboard/dashboard-blocks";

export default function Example({ dashboard }: { dashboard: UsageDashboard }) {
  return <ModelUsageCard models={dashboard.models} />;
}`,
    notes: "This autonomous composition is reused directly in the admin dashboard. The preview uses local sample data; source code contains the production component and its chart dependencies.",
  },
  {
    slug: "stage-spend",
    kind: "block",
    title: "Stage spend",
    description: "Pipeline-stage spend with labelled bars, proportions and the dashboard card frame.",
    group: "Analytics",
    preview: "block",
    variants: ["Populated", "Empty"],
    sources: ["apps/web/src/components/insights/dashboard/dashboard-blocks.tsx", "apps/web/src/components/insights/analytics-card.tsx", "apps/web/src/components/insights/analytics-card.module.css", "apps/web/src/components/insights/dashboard/dashboard-bars.tsx"],
    usage: `"use client";

import type { UsageDashboard } from "@agent-hub/core";
import { StageSpendCard } from "@/components/insights/dashboard/dashboard-blocks";

export default function Example({ dashboard }: { dashboard: UsageDashboard }) {
  return <StageSpendCard stages={dashboard.stages} />;
}`,
    notes: "This autonomous composition is reused directly in the admin dashboard. The preview uses local sample data; source code contains the production component and its chart dependencies.",
  },
  {
    slug: "latency",
    kind: "block",
    title: "Latency",
    description: "Latency distribution and trend, grouped as variations of the same analysis block.",
    group: "Analytics",
    preview: "block",
    variants: ["Distribution", "Trend", "Empty"],
    sources: ["apps/web/src/components/insights/dashboard/dashboard-blocks.tsx", "apps/web/src/components/insights/analytics-card.tsx", "apps/web/src/components/insights/analytics-card.module.css", "apps/web/src/components/insights/dashboard/dashboard-bars.tsx", "apps/web/src/components/insights/dashboard/dashboard-animated.tsx"],
    usage: `"use client";

import type { UsageDashboard } from "@agent-hub/core";
import { LatencyCard } from "@/components/insights/dashboard/dashboard-blocks";

export default function Example({ dashboard }: { dashboard: UsageDashboard }) {
  return <LatencyCard dashboard={dashboard} variant="distribution" />;
}`,
    notes: "This autonomous composition is reused directly in the admin dashboard. The preview uses local sample data; source code contains the production component and its chart dependencies.",
  },
  {
    slug: "rate-comparison",
    kind: "block",
    title: "Rate comparison",
    description: "Current and prior rates, percentage-point changes and comparison context in a complete card.",
    group: "Analytics",
    preview: "block",
    variants: ["Comparison", "No prior period", "Empty", "Loading"],
    sources: ["apps/web/src/components/insights/dashboard/dashboard-blocks.tsx", "apps/web/src/components/insights/analytics-card.tsx", "apps/web/src/components/insights/analytics-card.module.css", "apps/web/src/components/insights/dashboard/dashboard-comparisons.tsx"],
    usage: `"use client";

import type { UsageDashboard } from "@agent-hub/core";
import { RatesComparisonCard } from "@/components/insights/dashboard/dashboard-blocks";

export default function Example({ dashboard }: { dashboard: UsageDashboard }) {
  return <RatesComparisonCard current={dashboard.totals} previous={null} />;
}`,
    notes: "This autonomous composition is reused directly in the admin dashboard. The preview uses local sample data; source code contains the production component and its chart dependencies.",
  },
  {
    slug: "flow-ranking",
    kind: "block",
    title: "Flow ranking",
    description: "A ranked flow chart, selection, legend and time-granularity caption in one block.",
    group: "Analytics",
    preview: "block",
    variants: ["Populated", "Empty"],
    sources: ["apps/web/src/components/insights/dashboard/dashboard-blocks.tsx", "apps/web/src/components/insights/analytics-card.tsx", "apps/web/src/components/insights/analytics-card.module.css", "apps/web/src/components/insights/dashboard/dashboard-animated.tsx"],
    usage: `"use client";

import type { UsageDashboard } from "@agent-hub/core";
import { FlowRankingCard } from "@/components/insights/dashboard/dashboard-blocks";

export default function Example({ dashboard }: { dashboard: UsageDashboard }) {
  return <FlowRankingCard flows={dashboard.flows} />;
}`,
    notes: "This autonomous composition is reused directly in the admin dashboard. The preview uses local sample data; source code contains the production component and its chart dependencies.",
  },
  {
    slug: "rate-cards",
    kind: "block",
    title: "Rate cards",
    description: "Complete Reliability, Answer accuracy and Autonomy cards with rate visuals, counts and supporting charts.",
    group: "Analytics",
    preview: "block",
    variants: ["Reliability gauge", "Accuracy gauge", "Autonomy gauge", "Empty", "Loading"],
    sources: ["apps/web/src/components/insights/dashboard/dashboard-kit.tsx", "apps/web/src/components/insights/dashboard/dashboard-donut.tsx", "apps/web/src/components/insights/dashboard/dashboard-bars.tsx", "apps/web/src/components/insights/analytics-card.tsx", "apps/web/src/components/insights/analytics-card.module.css"],
    usage: `"use client";

import { RateCard } from "@/components/insights/dashboard/dashboard-kit";

export default function Example() {
  return <RateCard title="Reliability" description="Turns that finished without an error"
    variant="gauge" good={96} bad={4} goodLabel="Succeeded" badLabel="Failed"
    loading={false} empty="No finished turns in this range." />;
}`,
    notes: "Select one rate at a time. These are variants of one complete block: each gauge represents a different rate, while the frame, supporting counts and empty/loading states share the RateCard implementation.",
  },
];

export function catalogPath(family: ComponentFamily): `/${string}` {
  return family.kind === "block" ? `/components/blocks/${family.slug}` : `/components/${family.slug}`;
}

export function componentFamily(slug: string): ComponentFamily | undefined {
  return COMPONENT_FAMILIES.find((family) => family.slug === slug);
}
