"use client";

import { MorphText } from "@/components/motion/morph-text";
import { ArcPicker } from "@/components/motion/arc-picker";

import { useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpRight,
  Check,
  ChevronDown,
  Copy,
  Folder,
  GripVertical,
  Mail,
  MoreHorizontal,
  Plus,
  Search,
  Settings,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  CopyFeedbackIcon,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Hint,
  Input,
  Label,
  PasswordInput,
  Popover,
  PopoverClose,
  PopoverContent,
  PopoverTrigger,
  ProgressiveBlur,
  Skeleton,
  TooltipProvider,
  useCopyFeedback,
} from "@agent-hub/ui";
import { FeedbackProvider } from "@agent-hub/ui/feedback";
import { ActionSwapText } from "@/components/motion/action-swap";
import { AgentCode } from "@/components/agents/agent-code";
import { CodeBlock as AgentCodeBlock } from "@/components/agents/code-block";
import { TrustBadge } from "@/components/assistant/trust-badge";
import { FLOW_BUTTON_ICON_OPTIONS, FlowButtonIcon } from "@/components/chat/flow-button-icon";
import { Magnetic } from "@/components/core/magnetic";
import {
  MorphingDialog,
  MorphingDialogClose,
  MorphingDialogContainer,
  MorphingDialogContent,
  MorphingDialogDescription,
  MorphingDialogTitle,
  MorphingDialogTrigger,
} from "@/components/core/morphing-dialog";
import { RailPanel } from "@/components/chat/rail-panel";
import { FeatureCard } from "@/components/home/feature-card";
import { FeatureCardFace } from "@/components/home/feature-card-face";
import { AvailabilityScheduler } from "@/components/help-desks/availability-scheduler";
import type { WeekHours } from "@/components/help-desks/availability-scheduler/types";
import { SpotlightCard } from "@/components/marketing/spotlight-card";
import { SourceStatusBadge } from "@/components/knowledge/source-status-badge";
import { BottomSheet } from "@/components/motion/bottom-sheet";
import { BouncyAccordion } from "@/components/motion/bouncy-accordion";
import { Button as MotionButton } from "@/components/motion/button";
import {
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/motion/context-menu";
import { GridBeam } from "@/components/motion/grid-beam";
import { Input as MotionInput } from "@/components/motion/input";
import { LoadingReveal } from "@/components/motion/loading-reveal";
import { MorphingModal } from "@/components/motion/morphing-modal";
import { PageReveal } from "@/components/motion/page-reveal";
import {
  MorphPopover,
  MorphPopoverContent,
  MorphPopoverTrigger,
} from "@/components/motion/popover-morph";
import { PreviewRail } from "@/components/motion/preview-rail";
import { RollInText, RollRow } from "@/components/motion/roll-in-text";
import { RollingNumber } from "@/components/motion/rolling-number";
import { SlidingPanel } from "@/components/motion/sliding-panel";
import { Table as MotionTable } from "@/components/motion/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/motion/tabs";
import { TextShimmer } from "@/components/motion/text-shimmer";
import { TiltCard } from "@/components/motion/tilt-card";
import { ThemeSettingsClient } from "@/components/settings/theme-settings-client";
import { FieldHeader } from "@/components/settings/field-header";
import { PendingSubmitButton } from "@/components/settings/pending-submit-button";
import { StatusBadge } from "@/components/spaceui/status-badge";
import { SkeletonReveal } from "@/components/spectrumui/skeleton-reveal";
import { SoundSwitcher } from "@/components/sound-switcher";
import { ThemeSwitcher } from "@/components/theme-switcher";
import { GroupAvatarCluster } from "@/components/teammates/group-avatar-cluster";
import { TeammateAvatar } from "@/components/teammates/teammate-avatar";
import { AnimatedGlyph, AnimatedIcon, StaticIcons } from "@/components/ui/animated-icon";
import { Assignees, type Assignee } from "@/components/ui/assignees";
import { Calendar, CalendarRange } from "@/components/ui/calendar";
import { Checkbox } from "@/components/ui/checkbox";
import { ColorPicker } from "@/components/ui/color-picker";
import { CodeBlock } from "@/components/ui/code-block";
import { useConfirmDelete } from "@/components/ui/confirm-delete-modal";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EmptyState } from "@/components/ui/empty-state";
import { FileUpload, type FileUploadItem } from "@/components/ui/file-upload";
import { FeatherIcon } from "@/components/ui/feather-icon";
import { FilterSelect } from "@/components/ui/filter-select";
import { GeneratedAvatar } from "@/components/ui/generated-avatar";
import { HoverHighlight } from "@/components/ui/hover-highlight";
import { BotIcon } from "@/components/ui/icons/bot";
import { FoldersIcon } from "@/components/ui/icons/folders";
import { MailboxIcon } from "@/components/ui/icons/mailbox";
import { Maximize2Icon } from "@/components/ui/icons/maximize-2";
import { MessageCircleIcon } from "@/components/ui/icons/message-circle";
import { ScanTextIcon } from "@/components/ui/icons/scan-text";
import { TelescopeIcon } from "@/components/ui/icons/telescope";
import { UserRoundCogIcon } from "@/components/ui/icons/user-round-cog";
import { UsersRoundIcon } from "@/components/ui/icons/users-round";
import { Volume2Icon } from "@/components/ui/icons/volume-2";
import { ListInput } from "@/components/ui/list-input";
import { Switch as MotionSwitch } from "@/components/ui/motion-switch";
import { RadioGroup } from "@/components/ui/radio-group";
import { ResizeHandle, useResizableWidth } from "@/components/ui/resizable-panel";
import { SectionHeading } from "@/components/ui/section-heading";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SlideToConfirm } from "@/components/ui/slide-to-confirm";
import { SidebarToggleIcon } from "@/components/ui/sidebar-toggle-icon";
import { SortableHandle, SortableItem, SortableList } from "@/components/ui/sortable-list";
import { Switch } from "@/components/ui/switch";
import { Table, TableActions, TableBody, TableCard, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TablePagination } from "@/components/ui/table-pagination";
import { TableColumnHeader, useClientSort } from "@/components/ui/table-column-header";
import { useColumnWidths } from "@/components/ui/table-columns";
import { TableRowMenu } from "@/components/ui/table-menu";
import { TableOpenCell } from "@/components/ui/table-open-cell";
import { SelectAllHead, SelectRowCell, TableBulkBar, useRowSelection } from "@/components/ui/table-selection";
import { UserAvatar } from "@/components/ui/user-avatar";
import { Textarea } from "@/components/ui/textarea";

/** Preview-only fixtures render the same controls the production app imports. */
function Example({ title, children, wide = false }: { title: string; children: ReactNode; wide?: boolean }) {
  return <section className={wide ? "w-full space-y-3" : "w-full max-w-xl space-y-3"}>
    <h3 className="text-xs font-medium text-muted-foreground">{title}</h3>
    {children}
  </section>;
}

function Stack({ children }: { children: ReactNode }) {
  return <div data-foley-silent className="flex w-full min-w-0 flex-col items-start gap-6">{children}</div>;
}

function ButtonPreview() {
  const [presses, setPresses] = useState(0);
  const [submitted, setSubmitted] = useState(false);
  const press = () => setPresses((value) => value + 1);
  return <Stack>
    <Example title="Variants">
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={press}>Primary</Button>
        <Button variant="secondary" onClick={press}>Secondary</Button>
        <Button variant="outline" onClick={press}>Outline</Button>
        <Button variant="ghost" onClick={press}>Ghost</Button>
        <Button variant="destructive" onClick={press}>Destructive</Button>
        <Button variant="outline" static onClick={press}>Static feedback</Button>
        <Button variant="outline" disabled>Disabled</Button>
      </div>
    </Example>
    <Example title="Sizes and icons">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="xs" onClick={press}>Extra small</Button>
        <Button variant="outline" size="sm" onClick={press}>Small</Button>
        <Button variant="outline" onClick={press}>Default</Button>
        <Button variant="outline" size="lg" onClick={press}>Large</Button>
        <Button variant="outline" size="icon-sm" aria-label="Add item" onClick={press}><Plus /></Button>
        <Button variant="outline" size="icon" aria-label="Open settings" onClick={press}><Settings /></Button>
        <Button variant="outline" size="icon-lg" aria-label="Search" onClick={press}><Search /></Button>
        <Button variant="outline" render={<Link href="/components/inputs" />}><ArrowUpRight /> Explore inputs</Button>
      </div>
    </Example>
    <Example title="Motion icon variants">
      <div className="flex gap-2">
        <MotionButton aria-label="Add example" onClick={press}><Plus className="size-4" /></MotionButton>
        <MotionButton variant="ghost" aria-label="More options" onClick={press}><MoreHorizontal className="size-4" /></MotionButton>
      </div>
    </Example>
    <Example title="Pending submit state">
      <form action={async () => { await new Promise<void>((resolve) => setTimeout(resolve, 750)); setSubmitted(true); }}><PendingSubmitButton variant="outline" pendingLabel="Saving…">Save example</PendingSubmitButton></form>
      <p role="status" className="text-xs text-muted-foreground">{submitted ? "Example saved locally." : "Submitting shows the form pending state."}</p>
    </Example>
    <p role="status" className="text-xs text-muted-foreground">{presses} clicks in this preview</p>
  </Stack>;
}

function InputPreview() {
  const id = useId();
  const [value, setValue] = useState("");
  return <Stack><Example title="Text, invalid and disabled states">
    <div className="space-y-2"><Label htmlFor={id}>Assistant name</Label><Input id={id} value={value} onChange={(event) => setValue(event.target.value)} placeholder="Support assistant" /></div>
    <Input aria-label="Invalid assistant name" aria-invalid placeholder="A name is required" />
    <Input aria-label="Disabled assistant name" disabled value="Unavailable" />
  </Example></Stack>;
}

function TextareaPreview() {
  const id = useId();
  const [value, setValue] = useState("Answer clearly and cite the source when you use knowledge.");
  return <Stack><Example title="Multiline · controlled and disabled">
    <div className="space-y-2"><Label htmlFor={id}>Answering style</Label><Textarea id={id} value={value} onChange={(event) => setValue(event.target.value)} maxLength={240} /><p className="text-xs text-muted-foreground">{value.length}/240 characters</p></div>
    <Textarea aria-label="Disabled textarea" disabled placeholder="Disabled" />
    <Textarea aria-label="Invalid textarea" aria-invalid placeholder="A description is required" />
  </Example></Stack>;
}

function LabelPreview() {
  const id = useId();
  const [checked, setChecked] = useState(false);
  return <Stack><Example title="Field and choice associations">
    <div className="space-y-2"><Label htmlFor={id}>Assistant name <span className="font-normal text-muted-foreground">Required</span></Label><Input id={id} placeholder="Click the label to focus this field" /></div>
    <div className="flex items-center gap-2"><Checkbox id={`${id}-choice`} checked={checked} onCheckedChange={setChecked} /><Label htmlFor={`${id}-choice`}>Include source citations</Label></div>
    <div className="space-y-2"><Label htmlFor={`${id}-disabled`}>Unavailable field</Label><Input id={`${id}-disabled`} disabled value="Disabled" /></div>
  </Example></Stack>;
}

function SwitchPreview() {
  const [checked, setChecked] = useState(true);
  const [small, setSmall] = useState(false);
  const [base, setBase] = useState(false);
  const [staticChecked, setStaticChecked] = useState(false);
  const id = useId();
  return <Stack>
    <Example title="Default and small"><div className="flex flex-col items-start gap-4"><MotionSwitch checked={checked} onCheckedChange={setChecked} label="Enable assistant" /><MotionSwitch size="sm" checked={small} onCheckedChange={setSmall} label="Small switch" /><MotionSwitch checked={staticChecked} onCheckedChange={setStaticChecked} static label="Static feedback" /><MotionSwitch checked disabled onCheckedChange={() => {}} label="Disabled" /></div></Example>
    <Example title="Compatibility import · same primitive"><div className="flex items-center gap-3"><Switch id={id} checked={base} onCheckedChange={setBase} /><Label htmlFor={id}>Send notifications</Label></div></Example>
  </Stack>;
}

function CheckboxPreview() {
  const id = useId();
  const [checked, setChecked] = useState(true);
  return <Stack><Example title="Checked · indeterminate · disabled"><div className="flex flex-col gap-4">
    <div className="flex items-center gap-3"><Checkbox id={`${id}-checked`} checked={checked} onCheckedChange={setChecked} /><Label htmlFor={`${id}-checked`}>Include sources</Label></div>
    <div className="flex items-center gap-3"><Checkbox id={`${id}-indeterminate`} indeterminate /><Label htmlFor={`${id}-indeterminate`}>Some rows selected</Label></div>
    <div className="flex items-center gap-3"><Checkbox id={`${id}-disabled`} checked disabled /><Label htmlFor={`${id}-disabled`}>Disabled selection</Label></div>
  </div></Example></Stack>;
}

function RadioPreview() {
  const [value, setValue] = useState("team");
  return <Stack><Example title="Single choice · option hints and disabled state"><RadioGroup aria-label="Visibility" value={value} onValueChange={setValue} options={[
    { value: "private", label: "Private", hint: "Only you can open this assistant." },
    { value: "team", label: "Team", hint: "Available to your workspace." },
    { value: "public", label: "Public", hint: "Disabled in this preview.", disabled: true },
  ]} /></Example></Stack>;
}

const SELECT_OPTIONS = [{ value: "draft", label: "Draft" }, { value: "published", label: "Published" }, { value: "archived", label: "Archived" }];

function SelectPreview() {
  const [single, setSingle] = useState("published");
  const [multiple, setMultiple] = useState(["draft", "published"]);
  return <Stack>
    <Example title="Single select"><Select value={single} onValueChange={setSingle}><SelectTrigger aria-label="Assistant status"><SelectValue /></SelectTrigger><SelectContent>{SELECT_OPTIONS.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent></Select></Example>
    <Example title="Multiple select"><Select multiple value={multiple} onValueChange={setMultiple}><SelectTrigger aria-label="Included statuses"><SelectValue placeholder="Choose statuses" /></SelectTrigger><SelectContent>{SELECT_OPTIONS.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent></Select></Example>
    <Example title="Disabled"><Select disabled value="draft"><SelectTrigger aria-label="Disabled status"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="draft">Draft</SelectItem></SelectContent></Select></Example>
  </Stack>;
}

function FilterPreview() {
  const [status, setStatus] = useState("");
  const [language, setLanguage] = useState("");
  return <Stack><Example title="Catalogued options · custom values"><div className="grid gap-4"><FilterSelect label="Status" value={status} onChange={setStatus} placeholder="All statuses" options={SELECT_OPTIONS} /><FilterSelect label="Language" value={language} onChange={setLanguage} placeholder="Any language" allowCustom options={[{ value: "English", label: "English" }, { value: "Italian", label: "Italian" }]} /></div></Example></Stack>;
}

function TabsPreview() {
  const [value, setValue] = useState("overview");
  return <Stack><Example title="Shared motion tabs · sliding content"><Tabs value={value} onValueChange={setValue}><TabsList aria-label="Assistant sections"><TabsTrigger value="overview">Overview</TabsTrigger><TabsTrigger value="knowledge">Knowledge</TabsTrigger><TabsTrigger value="activity">Activity</TabsTrigger><TabsTrigger value="disabled" disabled>Disabled</TabsTrigger></TabsList><div className="relative min-h-28"><TabsContent value="overview"><p className="text-sm">An overview of your assistant.</p></TabsContent><TabsContent value="knowledge"><p className="text-sm">Connected collections, files, and sources.</p></TabsContent><TabsContent value="activity"><p className="text-sm">Recent conversations and updates.</p></TabsContent></div></Tabs></Example></Stack>;
}

function BadgePreview() {
  return <Stack>
    <Example title="Semantic tones"><div className="flex flex-wrap gap-2"><Badge tone="gray">Draft</Badge><Badge tone="blue">Processing</Badge><Badge tone="green">Ready</Badge><Badge tone="amber">Needs review</Badge><Badge tone="red">Failed</Badge><Badge tone="purple">AI-generated</Badge></div></Example>
    <Example title="Variants"><div className="flex flex-wrap gap-2"><Badge>Default</Badge><Badge variant="secondary">Secondary</Badge><Badge variant="outline">Outline</Badge><Badge variant="destructive">Destructive</Badge><Badge tone="green"><Check /> Published</Badge></div></Example>
  </Stack>;
}

function CardPreview() {
  const [details, setDetails] = useState(false);
  return <Stack><Example title="Default and compact" wide><div className="grid w-full gap-4 sm:grid-cols-2">
    <Card><CardHeader><CardTitle>Knowledge collection</CardTitle><CardDescription>Documentation connected to your assistant.</CardDescription></CardHeader><CardContent><p className="text-sm text-muted-foreground">24 documents · Updated today</p>{details && <p role="status" className="mt-2 text-sm">All documents are ready for search.</p>}</CardContent><CardFooter><Button variant="outline" size="sm" onClick={() => setDetails((value) => !value)}>{details ? "Hide details" : "Show details"}</Button></CardFooter></Card>
    <Card size="sm"><CardHeader><CardTitle>Compact card</CardTitle><CardDescription>Smaller spacing for dense surfaces.</CardDescription></CardHeader><CardContent><p className="text-sm">The same Card with compact spacing.</p></CardContent></Card>
  </div></Example></Stack>;
}

function DialogPreview() {
  const [name, setName] = useState("Support assistant");
  const [savedName, setSavedName] = useState("");
  return <Stack><Example title="Rename an example">
    <Dialog><DialogTrigger render={<Button variant="outline" />}>Open dialog</DialogTrigger><DialogContent><DialogHeader><DialogTitle>Rename assistant</DialogTitle><DialogDescription>Changes here belong to this preview.</DialogDescription></DialogHeader><Input aria-label="Assistant name" value={name} onChange={(event) => setName(event.target.value)} /><DialogFooter><DialogClose render={<Button variant="ghost" />}>Cancel</DialogClose><DialogClose render={<Button />} onClick={() => setSavedName(name)}>Save</DialogClose></DialogFooter></DialogContent></Dialog>
    <p role="status" className="min-h-4 text-xs text-muted-foreground">{savedName ? `Saved as ${savedName}.` : "Open, edit, save or cancel."}</p>
  </Example></Stack>;
}

function PopoverPreview() {
  return <Stack><Example title="Anchored panel"><Popover><PopoverTrigger render={<Button variant="outline" />}>Open popover</PopoverTrigger><PopoverContent className="w-64"><div className="space-y-3 p-2"><h3 className="text-sm font-medium">Quick settings</h3><p className="text-xs text-muted-foreground">A panel anchored to its trigger.</p><PopoverClose render={<Button variant="outline" size="sm" />}>Done</PopoverClose></div></PopoverContent></Popover></Example></Stack>;
}

function MenuPreview() {
  const [message, setMessage] = useState("Choose an action to see its result here.");
  return <Stack><Example title="Actions and disabled state">
    <DropdownMenu><DropdownMenuTrigger render={<Button variant="outline" />}>Actions <ChevronDown /></DropdownMenuTrigger><DropdownMenuContent className="w-52"><DropdownMenuLabel>Example assistant</DropdownMenuLabel><DropdownMenuItem onClick={() => setMessage("Duplicate selected.")}><Copy />Duplicate</DropdownMenuItem><DropdownMenuItem onClick={() => setMessage("Settings selected.")}><Settings />Settings</DropdownMenuItem><DropdownMenuItem disabled><Mail />Send email</DropdownMenuItem><DropdownMenuSeparator /><DropdownMenuItem variant="destructive" onClick={() => setMessage("Delete selected in this preview.")}><Trash2 />Delete</DropdownMenuItem></DropdownMenuContent></DropdownMenu>
    <p role="status" className="text-xs text-muted-foreground">{message}</p>
  </Example></Stack>;
}

function TooltipPreview() {
  return <TooltipProvider><Stack><Example title="Hint · top, bottom, left and right"><div className="flex flex-wrap gap-4">{(["top", "bottom", "left", "right"] satisfies Array<"top" | "bottom" | "left" | "right">).map((side) => <Hint key={side} label={`Tooltip on the ${side}`} side={side}><Button variant="outline" aria-label={`Show ${side} tooltip`}>{side}</Button></Hint>)}</div></Example></Stack></TooltipProvider>;
}

function AccordionPreview() {
  return <Stack><Example title="Bouncy accordion · connected groups"><BouncyAccordion items={[
    { id: "knowledge", title: "Where does the assistant find answers?", description: "Connected knowledge collections keep the original sources alongside each document." },
    { id: "flows", title: "How do flows work?", description: "Flows choose an ordered set of actions for each message." },
    { id: "preview", title: "Can I try changes first?", description: "Use the assistant preview before publishing." },
  ]} /></Example></Stack>;
}

function DrawerPreview() {
  const [view, setView] = useState("details");
  return <Stack><Example title="Views in one persistent panel">
    <div className="flex gap-2"><Button variant={view === "details" ? "secondary" : "ghost"} onClick={() => setView("details")}>Details</Button><Button variant={view === "review" ? "secondary" : "ghost"} onClick={() => setView("review")}>Review</Button></div>
    <SlidingPanel activeKey={view} direction={view === "review" ? 1 : -1} sizing="flow" className="min-h-32 rounded-lg border border-alpha-medium p-4"><div className="space-y-2"><p className="text-sm font-medium">{view === "details" ? "Assistant details" : "Review changes"}</p><p className="text-sm text-muted-foreground">{view === "details" ? "Choose the name and description visitors will see." : "Check your changes before publishing the assistant."}</p></div></SlidingPanel>
  </Example></Stack>;
}

function BottomSheetPreview() {
  const [open, setOpen] = useState(false);
  return <Stack><Example title="Bottom sheet · draggable viewport snap points"><Button variant="outline" onClick={() => setOpen(true)}>Open bottom sheet</Button><BottomSheet open={open} onOpenChange={setOpen} snapPoints={[0.4, 0.7]} title="Assistant settings" description="Drag the handle between the two heights or down to close."><div className="space-y-4 py-4"><Input aria-label="Assistant name" defaultValue="Support assistant" /><Textarea aria-label="Description" defaultValue="Help visitors find the answers they need." /><Button variant="outline" onClick={() => setOpen(false)}>Done</Button></div></BottomSheet></Example></Stack>;
}

const TABLE_ROWS = [
  { id: "support", name: "Support assistant", status: "Published", documents: 24 },
  { id: "onboarding", name: "Onboarding", status: "Draft", documents: 12 },
  { id: "research", name: "Research", status: "Published", documents: 38 },
];

const TABLE_BLOCK_ROWS = Array.from({ length: 18 }, (_, index) => {
  const row = TABLE_ROWS[index % TABLE_ROWS.length];
  return { ...row, id: `${row.id}-${index}`, name: index < 3 ? row.name : `${row.name} ${Math.floor(index / 3) + 1}`, documents: row.documents + index };
});

function TablePreview() {
  const [filter, setFilter] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [message, setMessage] = useState("");
  const sort = useClientSort();
  const allRows = sort.sorted(TABLE_BLOCK_ROWS.filter((row) => row.name.toLowerCase().includes(filter.toLowerCase())), { name: (row) => row.name, documents: (row) => row.documents });
  const currentPage = Math.min(page, Math.max(1, Math.ceil(allRows.length / pageSize)));
  const rows = allRows.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const selection = useRowSelection(rows.map((row) => row.id));
  const { colGroup, handleFor } = useColumnWidths("component-catalog-tables", [
    { key: "selection", width: 40, fixed: true },
    { key: "name", width: 240 },
    { key: "status", width: 160 },
    { key: "documents", width: 120 },
    { key: "actions", width: 80, fixed: true },
  ]);
  return <Stack><Example title="Assistants · sort, filter, resize, select and page" wide>
    <TableCard footer={<TablePagination page={currentPage} pageSize={pageSize} total={allRows.length} noun="assistant" onPageChange={setPage} onPageSizeChange={(value) => { setPageSize(value); setPage(1); }} />}>
      <TableBulkBar count={selection.count} noun="assistant" onClear={selection.clear}><Button variant="outline" size="sm" onClick={() => setMessage(`${selection.count} example assistants selected for export.`)}>Export selection</Button></TableBulkBar>
      <Table fixed empty={rows.length === 0}>{colGroup}<TableHeader><TableRow>
        <SelectAllHead state={selection.allState} onToggle={selection.toggleAll} />
        <TableColumnHeader label="Name" sort={sort.column("name")} filter={{ kind: "text", value: filter, onChange: (value) => { setFilter(value); setPage(1); } }} resize={handleFor("name")} />
        <TableColumnHeader label="Status" resize={handleFor("status")} />
        <TableColumnHeader label="Documents" sort={sort.column("documents")} resize={handleFor("documents")} align="right" />
        <TableHead>Actions</TableHead>
      </TableRow></TableHeader><TableBody>{rows.map((row) => <TableRowMenu key={row.id} title={row.name} onOpen={() => selection.selectForMenu(row.id)} actions={[{ label: "Settings", icon: Settings, onSelect: () => setMessage(`Settings for ${row.name} selected.`) }]}><TableRow>
        <SelectRowCell checked={selection.isSelected(row.id)} onToggle={() => selection.toggle(row.id)} label={row.name} />
        <TableCell><TableOpenCell href="/components/table" label="Table components">{row.name}</TableOpenCell></TableCell>
        <TableCell><Badge tone={row.status === "Published" ? "green" : "gray"}>{row.status}</Badge></TableCell>
        <TableCell className="text-right tabular-nums">{row.documents}</TableCell>
        <TableCell><TableActions><Button variant="ghost" size="icon-sm" aria-label={`Settings for ${row.name}`} onClick={() => setMessage(`Settings for ${row.name} selected.`)}><Settings /></Button></TableActions></TableCell>
      </TableRow></TableRowMenu>)}{rows.length === 0 && <TableRow><TableCell colSpan={5}><EmptyState size="sm" title="No matching assistants" description="Clear the name filter to see the examples." action={<Button variant="outline" size="sm" onClick={() => setFilter("")}>Clear filter</Button>} /></TableCell></TableRow>}</TableBody></Table>
    </TableCard><p role="status" className="min-h-4 text-xs text-muted-foreground">{message || "Open a column heading for sorting and filtering. Drag its edge to resize."}</p>
  </Example></Stack>;
}

function CalendarPreview() {
  const [day, setDay] = useState("2026-10-04");
  const [range, setRange] = useState({ from: "2026-10-04", to: "2026-10-10" });
  return <Stack>
    <Example title="Single date · Cancel and Apply"><Calendar value={day} onSelect={setDay} /><p role="status" className="text-xs text-muted-foreground">Committed date: {day || "No date selected"}</p></Example>
    <Example title="Range · two months" wide><CalendarRange from={range.from} to={range.to} onSelect={(from, to) => setRange({ from, to })} /><p role="status" className="text-xs text-muted-foreground">{range.from} — {range.to}</p></Example>
  </Stack>;
}

function ColorPreview() {
  const [value, setValue] = useState("#5E6AD2");
  return <Stack><Example title="HSV picker · HEX, RGB, CSS and HSL"><ColorPicker value={value} onChange={setValue} /><p role="status" className="text-xs text-muted-foreground">Selected: {value}</p></Example></Stack>;
}

const UPLOAD_FIXTURES: FileUploadItem[] = [
  { id: "guide", name: "product-guide.pdf", size: 245000, type: "application/pdf", status: "success", progress: 100 },
  { id: "sheet", name: "contacts.csv", size: 12000, type: "text/csv", status: "uploading", progress: 62 },
  { id: "failed", name: "draft-notes.txt", size: 3100, type: "text/plain", status: "error", error: "Example failure" },
];

function UploadPreview() {
  const [items, setItems] = useState(UPLOAD_FIXTURES);
  const finishItems = (added: FileUploadItem[]) => setItems((current) => current.map((item) => added.some((entry) => entry.id === item.id) ? { ...item, status: "success", progress: 100, error: undefined } : item));
  return <Stack><Example title="Drop zone · queued, progress, success and error" wide><FileUpload value={items} onValueChange={setItems} onFilesAdded={finishItems} onRetry={(item) => finishItems([item])} accept=".pdf,.txt,.md,.csv" title="Choose files for this preview" description="Files stay in this browser. The upload completion is simulated locally." /><Button variant="outline" size="sm" onClick={() => setItems(UPLOAD_FIXTURES)}>Reset examples</Button></Example></Stack>;
}

function SortablePreview() {
  const [values, setValues] = useState(["Search knowledge", "Suggest follow-ups", "Offer support"]);
  function move(value: string, delta: number) {
    const index = values.indexOf(value);
    const nextIndex = index + delta;
    if (nextIndex < 0 || nextIndex >= values.length) return;
    const next = [...values];
    next.splice(index, 1);
    next.splice(nextIndex, 0, value);
    setValues(next);
  }
  return <Stack><Example title="Drag handle · reorder locally"><SortableList values={values} onReorder={setValues} className="space-y-2">{values.map((value, index) => <SortableItem key={value} value={value} className="flex items-center gap-3 rounded-lg border bg-card p-3"><SortableHandle aria-label={`Drag ${value}`} className="press-control cursor-grab p-1 text-muted-foreground"><GripVertical className="size-4" /></SortableHandle><span className="min-w-0 flex-1 text-sm">{value}</span><Button variant="ghost" size="icon-sm" disabled={index === 0} aria-label={`Move ${value} up`} onClick={() => move(value, -1)}><ArrowUp /></Button><Button variant="ghost" size="icon-sm" disabled={index === values.length - 1} aria-label={`Move ${value} down`} onClick={() => move(value, 1)}><ArrowDown /></Button></SortableItem>)}</SortableList></Example></Stack>;
}

function ListPreview() {
  const id = useId();
  const [values, setValues] = useState(["support", "onboarding"]);
  return <Stack><Example title="Text field backed by a list"><div className="space-y-2"><Label htmlFor={id}>Tags</Label><ListInput id={id} values={values} onChange={setValues} separator="," placeholder="support, onboarding" /></div><div className="flex flex-wrap gap-2">{values.map((value, index) => <Badge key={`${value}-${index}`} variant="secondary">{value}</Badge>)}</div><p className="text-xs text-muted-foreground">Separate entries with commas.</p></Example></Stack>;
}

function AvatarPreview() {
  return <Stack><Example title="Seeded identity · static and animated"><div className="flex flex-wrap items-center gap-6"><GeneratedAvatar seed="catalog-member" size="size-12" /><GeneratedAvatar seed="catalog-member" size="size-16" /><GeneratedAvatar seed="catalog-teammate" animated size="size-16" /></div></Example></Stack>;
}

function IconPreview() {
  const [selected, setSelected] = useState("Hover or press an icon.");
  return <Stack>
    <Example title="Animated glyphs"><div className="flex flex-wrap gap-2">{[{ icon: Search, name: "Search" }, { icon: Settings, name: "Settings" }, { icon: Plus, name: "Add" }, { icon: Folder, name: "Folder" }, { icon: Copy, name: "Copy" }].map(({ icon, name }) => <Button key={name} variant="outline" onClick={() => setSelected(`${name} selected.`)}><AnimatedIcon icon={icon} size={16} />{name}</Button>)}</div></Example>
    <Example title="Local animated glyphs"><div className="flex flex-wrap gap-2">{[{ icon: FoldersIcon, name: "Folders" }, { icon: MailboxIcon, name: "Mailbox" }, { icon: Maximize2Icon, name: "Expand" }, { icon: MessageCircleIcon, name: "Message" }, { icon: TelescopeIcon, name: "Evaluate" }, { icon: UserRoundCogIcon, name: "Account" }, { icon: UsersRoundIcon, name: "Members" }, { icon: Volume2Icon, name: "Sound" }].map(({ icon, name }) => <Button key={name} variant="outline" onClick={() => setSelected(`${name} selected.`)}><AnimatedGlyph icon={icon} size={16} />{name}</Button>)}<Button variant="outline" onClick={() => setSelected("Scan selected.")}><ScanTextIcon className="size-4" />Scan</Button></div></Example>
    <Example title="Static scope"><StaticIcons><div className="flex items-center gap-4"><AnimatedIcon icon={Search} size={24} /><AnimatedIcon icon={Settings} size={24} /><AnimatedIcon icon={Folder} size={24} /></div></StaticIcons></Example>
    <p role="status" className="text-xs text-muted-foreground">{selected}</p>
  </Stack>;
}

function EmptyPreview() {
  const [searched, setSearched] = useState(false);
  return <Stack>
    <Example title="Default · content changes in place"><EmptyState title={searched ? "No results found" : "No collections yet"} description={searched ? "Try another search or clear the current filters." : "Collections you connect to this assistant will appear here."} icon={searched ? <Search /> : <Folder />} action={<Button variant="outline" onClick={() => setSearched((value) => !value)}>{searched ? "Clear search" : "Try empty search"}</Button>} /></Example>
    <Example title="Compact · table or dense panel"><EmptyState size="sm" title="No recent activity" description="New conversations will appear here." /></Example>
  </Stack>;
}

function SkeletonPreview() {
  return <Stack><Example title="Shared skeleton · text, avatar and card"><div aria-busy="true" aria-label="Loading example" className="space-y-5"><div className="flex gap-3"><Skeleton className="size-12 rounded-full" /><div className="flex-1 space-y-2"><Skeleton className="h-4 w-36" /><Skeleton className="h-3 w-52 max-w-full" /></div></div><Skeleton className="h-28 w-full" /><div className="space-y-2"><Skeleton className="h-3 w-full" /><Skeleton className="h-3 w-4/5" /><Skeleton className="h-3 w-3/5" /></div></div></Example></Stack>;
}

function CopyPreview() {
  const { copyText, isCopied } = useCopyFeedback<string>();
  const [message, setMessage] = useState("Copy an example to the clipboard.");
  return <Stack><Example title="Clipboard feedback"><div className="flex flex-wrap items-center gap-2">{["Support assistant", "Knowledge collection"].map((value) => <Button key={value} variant="outline" onClick={async () => { const copied = await copyText(value, value); setMessage(copied ? `${value} copied.` : "Clipboard access was unavailable."); }}><CopyFeedbackIcon copied={isCopied(value)} />{isCopied(value) ? "Copied" : `Copy ${value}`}</Button>)}</div><p role="status" className="text-xs text-muted-foreground">{message}</p></Example><Example title="Idle and copied marks"><div className="flex items-center gap-6"><span className="flex items-center gap-2 text-sm"><CopyFeedbackIcon copied={false} />Copy</span><span className="flex items-center gap-2 text-sm"><CopyFeedbackIcon copied />Copied</span></div></Example></Stack>;
}

function ResizePreview() {
  const frame = useRef<HTMLDivElement>(null);
  const [maxWidth, setMaxWidth] = useState(320);
  useLayoutEffect(() => {
    const node = frame.current;
    if (!node) return;
    const measure = () => setMaxWidth(Math.max(120, Math.min(320, node.clientWidth - 48)));
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    measure();
    return () => observer.disconnect();
  }, []);
  const { width, resizing, beginResize, resizeTo, containerRef, widthTransition } = useResizableWidth({ defaultWidth: 240, minWidth: 120, maxWidth });
  const displayedWidth = Math.min(width, maxWidth);
  return <Stack><Example title="Resize handle · drag or use arrow keys" wide><div ref={frame} className="flex h-64 w-full items-stretch rounded-xl border bg-card"><div className="flex min-w-0 flex-1 items-center justify-center overflow-hidden p-3 text-center text-sm text-muted-foreground">Main</div><aside ref={containerRef} style={{ width: displayedWidth }} className={`relative shrink-0 border-l p-4 ${widthTransition}`}><ResizeHandle resizing={resizing} onPointerDown={beginResize} value={displayedWidth} minValue={120} maxValue={maxWidth} onValueChange={resizeTo} cornered="right" label="Resize example panel" /><p className="text-sm font-medium">Resizable panel</p><p className="mt-2 text-xs text-muted-foreground"><RollingNumber value={Math.round(displayedWidth)} /> px</p></aside></div><p className="text-xs text-muted-foreground">Focus the divider to resize with arrow keys, Home, or End.</p></Example></Stack>;
}

function TextMotionPreview() {
  const [label, setLabel] = useState("Support assistant");
  return <Stack><Example title="Text changes in place"><div className="min-h-9 text-2xl font-medium"><RollInText text={label} /></div><Button variant="outline" onClick={() => setLabel(label === "Support assistant" ? "Research assistant" : "Support assistant")}>Change label</Button></Example></Stack>;
}

function LoadingMotionPreview() {
  const [loading, setLoading] = useState(true);
  return <Stack><Example title="Loading and ready states"><LoadingReveal loading={loading} placeholder={<div className="space-y-3 py-2"><Skeleton className="h-5 w-36" /><Skeleton className="h-4 w-full" /><Skeleton className="h-4 w-4/5" /></div>}><div className="space-y-2 py-2"><p className="font-medium">Knowledge is ready</p><p className="text-sm text-muted-foreground">24 documents are available for search.</p></div></LoadingReveal><Button variant="outline" onClick={() => setLoading((value) => !value)}>{loading ? "Reveal content" : "Show skeleton"}</Button></Example></Stack>;
}

function ActionPreview() {
  const [saved, setSaved] = useState(false);
  return <Stack><Example title="ActionSwapText · rolling action label"><Button variant="outline" onClick={() => setSaved((value) => !value)}><ActionSwapText value={saved ? "saved" : "save"}>{saved ? <><Check className="mr-1.5 inline size-4" /> Saved</> : "Save changes"}</ActionSwapText></Button><p className="text-xs text-muted-foreground">Click to swap the label in place.</p></Example></Stack>;
}

function TiltPreview() {
  return <Stack><Example title="Default and subtle pointer response" wide><div className="grid gap-4 sm:grid-cols-2"><TiltCard className="border border-alpha-medium bg-card p-5"><Sparkles className="mb-6 size-6" /><p className="font-medium">Follow the pointer</p><p className="mt-2 text-sm text-muted-foreground">Tilt and a soft glare respond to mouse movement.</p></TiltCard><TiltCard max={3} glare={false} className="border border-alpha-medium bg-card p-5"><Folder className="mb-6 size-6" /><p className="font-medium">Subtle tilt</p><p className="mt-2 text-sm text-muted-foreground">Three degrees, without glare.</p></TiltCard></div></Example></Stack>;
}

function GridPreview() {
  return <Stack><Example title="GridBeam · travelling divider light" wide><GridBeam cols={3} rows={2} className="overflow-hidden rounded-xl border bg-card">{["Knowledge", "Flows", "Tools", "Conversations", "Insights", "Evaluation"].map((label) => <div key={label} className="flex min-h-28 items-center justify-center p-4 text-center text-sm">{label}</div>)}</GridBeam></Example></Stack>;
}

function RailPreview() {
  const [active, setActive] = useState("knowledge");
  const items = [
    { id: "knowledge", label: "Knowledge", description: "Sources and collections for grounded answers." },
    { id: "flows", label: "Flows", description: "Choose what happens for each intent." },
    { id: "tools", label: "Tools", description: "The capabilities your assistant can use." },
    { id: "activity", label: "Activity", description: "Conversations and recent changes." },
  ];
  return <Stack><Example title="PreviewRail · hover or focus each marker" wide><PreviewRail items={items} activeId={active} onActiveChange={setActive} highlightActive label="Preview sections"><div className="flex min-h-80 items-center justify-center p-6"><Card className="w-full max-w-xs"><CardHeader><CardTitle>{items.find((item) => item.id === active)?.label}</CardTitle><CardDescription>Selected section</CardDescription></CardHeader><CardContent><p className="text-sm text-muted-foreground">Hover the rail to preview another section, then click to select it.</p></CardContent></Card></div></PreviewRail></Example></Stack>;
}

function BlurPreview() {
  return <Stack><Example title="ProgressiveBlur · contained scrolling example" wide><div className="relative h-72 overflow-hidden rounded-xl border bg-card"><div className="h-full overflow-y-auto p-6"><div className="space-y-6 pb-12">{["Knowledge collections", "Assistant flows", "Conversation history", "Source citations", "Tools and skills", "Evaluation results", "Usage and analytics", "End of the example"].map((title) => <div key={title}><p className="text-sm font-medium">{title}</p><p className="mt-1 text-sm text-muted-foreground">Scroll this preview to see the content soften toward the lower edge.</p></div>)}</div><ProgressiveBlur className="absolute inset-x-0 bottom-0 h-20" tint="var(--card)" maxBlur={12} /></div></div><p className="text-xs text-muted-foreground">The blur fades away as the scroller reaches its end.</p></Example></Stack>;
}

function ThemePreview() {
  return <Stack><Example title="Appearance preference"><ThemeSwitcher /></Example></Stack>;
}

function PasswordPreview() {
  const id = useId();
  return <Stack><Example title="Hidden, revealed and disabled states"><div className="space-y-2"><Label htmlFor={id}>Password</Label><PasswordInput id={id} defaultValue="preview-secret" autoComplete="off" /></div><PasswordInput aria-label="Disabled password" disabled defaultValue="preview-secret" /></Example></Stack>;
}

function MotionInputPreview() {
  const [invalid, setInvalid] = useState(false);
  return <Stack><Example title="Focus, typing and validation"><MotionInput label="Assistant name" placeholder="Support assistant" error={invalid ? "Choose a name for this assistant." : undefined} /><div className="flex gap-2"><Button variant="outline" size="sm" onClick={() => setInvalid((value) => !value)}>{invalid ? "Clear error" : "Show error"}</Button></div><MotionInput label="Disabled field" disabled placeholder="Unavailable" /></Example></Stack>;
}

function FieldHeaderPreview() {
  const id = useId();
  return <Stack><Example title="Field label with supporting text"><div className="space-y-2"><FieldHeader title="Answering style" hint="Choose how your assistant addresses visitors." htmlFor={id} /><Textarea id={id} aria-describedby={`${id}-hint`} defaultValue="Answer clearly and cite connected sources." /></div></Example></Stack>;
}

function SectionHeadingPreview() {
  return <Stack>
    <Example title="Console"><SectionHeading headingLevel={2} icon={Folder} title="Knowledge" description="Sources available to your assistant." /></Example>
    <Example title="Marketing" wide><SectionHeading headingLevel={2} icon={Sparkles} title="Connected knowledge" description="Every answer starts with a source." variant="marketing" eyebrow="Assistant platform" /></Example>
    <Example title="Compact preview"><SectionHeading headingLevel={3} icon={Folder} title="Knowledge" description="Your connected sources." variant="mock" /></Example>
  </Stack>;
}

function StatusBadgePreview() {
  return <Stack><Example title="Presence and activity"><div className="flex flex-wrap gap-2"><StatusBadge status="online" primaryText="Online" /><StatusBadge status="busy" primaryText="Busy" /><StatusBadge status="away" primaryText="Away" animated /><StatusBadge status="warning" primaryText="Warning" /><StatusBadge status="error" primaryText="Error" /><StatusBadge status="info" primaryText="Info" /><StatusBadge status="offline" primaryText="Offline" /></div></Example></Stack>;
}

function SourceStatusPreview() {
  return <TooltipProvider><Stack><Example title="Source processing states"><div className="flex flex-wrap gap-2"><SourceStatusBadge status="ready" /><SourceStatusBadge status="processing" /><SourceStatusBadge status="error" error="The source could not be reached." /></div></Example></Stack></TooltipProvider>;
}

function TrustPreview() {
  return <TooltipProvider><Stack><Example title="Earned autonomy tiers"><div className="flex flex-wrap gap-2">{(["auto", "queue", "watch"] satisfies Array<"auto" | "queue" | "watch">).map((tier) => <TrustBadge key={tier} trust={{ assistantId: "catalog-assistant", flowId: `catalog-${tier}`, organizationId: "catalog", runs: 20, passes: tier === "auto" ? 20 : tier === "queue" ? 16 : 8, tier, previousTier: null, computedAt: "2026-10-04T10:00:00Z" }} />)}</div></Example></Stack></TooltipProvider>;
}

function SpotlightPreview() {
  return <Stack><Example title="Pointer rim highlight"><SpotlightCard><Folder className="mb-5 size-6" /><p className="font-medium">Knowledge collections</p><p className="mt-2 text-sm text-muted-foreground">Move the pointer across the rim to see its highlight.</p></SpotlightCard></Example></Stack>;
}

const CATALOG_FEATURE = {
  title: "Knowledge that stays connected",
  body: "Original sources travel with each answer.",
  visual: () => <div className="grid h-40 place-items-center bg-alpha-lighter"><Folder className="size-10 text-muted-foreground" /></div>,
  details: ["Connect collections once, then keep each answer tied to its original source.", "This preview opens the same card into a detail view."],
};

function FeaturePreview() {
  return <Stack><Example title="Feature detail · card to dialog"><div className="w-full max-w-sm"><FeatureCard feature={CATALOG_FEATURE} /></div></Example></Stack>;
}

function FeatureFacePreview() {
  return <Stack><Example title="Static feature face"><div className="w-full max-w-sm"><FeatureCardFace feature={CATALOG_FEATURE} /></div></Example></Stack>;
}

function MorphingModalPreview() {
  const [view, setView] = useState<string | null>(null);
  return <Stack><Example title="One frame, multiple views"><Button variant="outline" onClick={() => setView("details")}>Open morphing modal</Button><MorphingModal viewId={view} title={view === "details" ? "Assistant details" : "Review assistant"} placement="center" onClose={() => setView(null)}><div className="space-y-4 pr-5"><h3 className="text-base font-medium">{view === "details" ? "Assistant details" : "Ready to publish"}</h3><p className="text-sm text-muted-foreground">{view === "details" ? "The modal keeps its frame as its content changes." : "Review the assistant before publishing. Changes stay in this preview."}</p><Button variant="outline" onClick={() => setView(view === "details" ? "review" : "details")}>{view === "details" ? "Continue" : "Back"}</Button></div></MorphingModal></Example></Stack>;
}

function MorphingDialogPreview() {
  return <Stack><Example title="Trigger expands into details"><MorphingDialog><MorphingDialogTrigger ariaLabel="Open collection details" className="press rounded-xl border border-alpha-medium bg-card p-5 text-left"><MorphingDialogTitle className="text-sm font-medium">Collection details</MorphingDialogTitle><p className="mt-2 text-xs text-muted-foreground">Open this surface</p></MorphingDialogTrigger><MorphingDialogContainer><MorphingDialogContent ariaLabel="Collection details" className="relative w-full max-w-md rounded-2xl border border-alpha-medium bg-card p-6"><MorphingDialogTitle className="pr-8 text-lg font-semibold">Collection details</MorphingDialogTitle><MorphingDialogDescription variants={{ initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } }}><p className="mt-3 text-sm text-muted-foreground">24 documents are available. Escape or the close control returns to the same trigger.</p></MorphingDialogDescription><MorphingDialogClose className="press-control rounded-md p-1 text-muted-foreground hover:bg-alpha-light"><X className="size-4" /></MorphingDialogClose></MorphingDialogContent></MorphingDialogContainer></MorphingDialog></Example></Stack>;
}

function ConfirmDeletePreview() {
  const [removed, setRemoved] = useState(false);
  const [fail, setFail] = useState(false);
  const { confirmDelete, confirmDeleteModal } = useConfirmDelete();
  function remove() {
    confirmDelete({
      title: "Remove this example?",
      description: "This only updates the preview status.",
      onConfirm: async () => {
        await new Promise<void>((resolve) => setTimeout(resolve, 750));
        if (fail) throw new Error("Sample removal failed. The example is still available.");
        setRemoved(true);
      },
    });
  }
  return <Stack><Example title="Confirm, pending and failure states"><div className="flex flex-wrap items-center gap-3"><Button variant="destructive" onClick={remove}>Remove example</Button><Switch checked={fail} onCheckedChange={setFail} label="Simulate failure" /></div>{confirmDeleteModal}<p role="status" className="text-xs text-muted-foreground">{removed ? "Example removed in this preview." : "The example is available."}</p>{removed && <Button variant="ghost" size="sm" onClick={() => setRemoved(false)}>Restore example</Button>}</Example></Stack>;
}

function MorphPopoverPreview() {
  const [open, setOpen] = useState(false);
  const [review, setReview] = useState(false);
  return <Stack><Example title="Anchored surface morph"><MorphPopover open={open} onOpenChange={setOpen}><MorphPopoverTrigger><Button variant="outline">Open morph popover</Button></MorphPopoverTrigger><MorphPopoverContent side="bottom" align="start" className="w-64"><div className="space-y-3 p-4"><h3 className="text-sm font-medium">{review ? "Review changes" : "Panel details"}</h3><p className="text-xs text-muted-foreground">{review ? "The preview keeps its anchor while the content changes." : "Outside click or Escape closes this panel."}</p><div className="flex gap-2"><Button variant="outline" size="sm" onClick={() => setReview((value) => !value)}>{review ? "Back" : "Review"}</Button><Button variant="ghost" size="sm" onClick={() => setOpen(false)}>Done</Button></div></div></MorphPopoverContent></MorphPopover></Example></Stack>;
}

function ContextMenuPreview() {
  const [pinned, setPinned] = useState(false);
  const [message, setMessage] = useState("Right-click, long press, or use Shift + F10.");
  return <Stack><Example title="Context actions"><ContextMenu><ContextMenuTrigger><div tabIndex={0} className="press-control grid min-h-32 place-items-center rounded-lg border border-dashed border-alpha-medium p-6 text-center text-sm text-muted-foreground">Open the context menu on this surface</div></ContextMenuTrigger><ContextMenuContent className="w-56"><ContextMenuLabel>Example item</ContextMenuLabel><ContextMenuItem onSelect={() => setMessage("Open selected.")}>Open</ContextMenuItem><ContextMenuCheckboxItem checked={pinned} onCheckedChange={setPinned}>Pin item</ContextMenuCheckboxItem><ContextMenuItem disabled>Share item</ContextMenuItem><ContextMenuSeparator /><ContextMenuItem tone="destructive" onSelect={() => setMessage("Remove selected in this preview.")}>Remove</ContextMenuItem></ContextMenuContent></ContextMenu><p role="status" className="text-xs text-muted-foreground">{pinned ? "Item pinned. " : ""}{message}</p></Example></Stack>;
}

function HoverHighlightPreview() {
  const [selected, setSelected] = useState("Overview");
  return <Stack><Example title="One highlight follows adjacent rows"><HoverHighlight className="space-y-1 rounded-lg border border-alpha-medium p-1">{["Overview", "Knowledge", "Conversations", "Archived"].map((label) => <Button key={label} data-highlight-row variant="ghost" disabled={label === "Archived"} className="relative w-full justify-start" onClick={() => setSelected(label)}>{label}</Button>)}</HoverHighlight><p role="status" className="text-xs text-muted-foreground">{selected} selected.</p></Example></Stack>;
}

function TableRowMenuPreview() {
  const [message, setMessage] = useState("Right-click, long press, or use Shift + F10.");
  return <Stack><Example title="Data-based row actions"><TableRowMenu title="Example row" actions={[{ label: "Open", icon: ArrowUpRight, onSelect: () => setMessage("Row opened in this preview.") }, { label: "Send email", icon: Mail, disabled: true }, { label: "Remove", icon: Trash2, destructive: true, onSelect: () => setMessage("Row removed in this preview.") }]}><div tabIndex={0} className="press-control rounded-lg border border-alpha-medium p-4 text-sm">Example table row</div></TableRowMenu><p role="status" className="text-xs text-muted-foreground">{message}</p></Example></Stack>;
}

function RailPanelPreview() {
  const [variant, setVariant] = useState<"page" | "docked">("page");
  const [collapsed, setCollapsed] = useState(false);
  return <Stack><Example title="Route and docked chrome" wide><div className="flex gap-2"><Button variant={variant === "page" ? "secondary" : "ghost"} size="sm" onClick={() => setVariant("page")}>Route</Button><Button variant={variant === "docked" ? "secondary" : "ghost"} size="sm" className="hidden md:inline-flex" onClick={() => { setVariant("docked"); setCollapsed(false); }}>Docked</Button></div><TooltipProvider><div className="flex h-72 w-full overflow-hidden rounded-lg border border-alpha-medium"><RailPanel title="Assistant preview" labels={{ show: "Show assistant preview", hide: "Hide assistant preview", resize: "Resize assistant preview" }} variant={variant} collapsed={collapsed} onCollapsedChange={setCollapsed} hideControl><div className="flex flex-1 items-center justify-center p-4 text-center text-sm text-muted-foreground">The rail owns the frame around its content.</div></RailPanel></div></TooltipProvider></Example></Stack>;
}

function NativeTablePreview() {
  return <Stack><Example title="Header, rows and cells" wide><Table><caption className="mt-3 text-left text-xs text-muted-foreground">Assistants connected to this organization.</caption><TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Documents</TableHead></TableRow></TableHeader><TableBody>{TABLE_ROWS.map((row) => <TableRow key={row.id}><TableCell>{row.name}</TableCell><TableCell>{row.status}</TableCell><TableCell className="text-right tabular-nums">{row.documents}</TableCell></TableRow>)}</TableBody></Table></Example></Stack>;
}

function ColumnHeaderPreview() {
  const [filter, setFilter] = useState("");
  const sort = useClientSort();
  const rows = sort.sorted(TABLE_ROWS.filter((row) => row.name.toLowerCase().includes(filter.toLowerCase())), { name: (row) => row.name });
  const { colGroup, handleFor } = useColumnWidths("component-catalog-column-header", [{ key: "name", width: 240 }, { key: "status", width: 160 }]);
  return <Stack><Example title="Sort, filter and resize in one column" wide><Table fixed>{colGroup}<TableHeader><TableRow><TableColumnHeader label="Name" sort={sort.column("name")} filter={{ kind: "text", value: filter, onChange: setFilter }} resize={handleFor("name")} /><TableHead>Status</TableHead></TableRow></TableHeader><TableBody>{rows.map((row) => <TableRow key={row.id}><TableCell>{row.name}</TableCell><TableCell>{row.status}</TableCell></TableRow>)}{rows.length === 0 && <TableRow><TableCell colSpan={2} className="text-muted-foreground">No matching assistants.</TableCell></TableRow>}</TableBody></Table><p className="text-xs text-muted-foreground">Click or right-click Name for its actions. Drag its edge to resize.</p></Example></Stack>;
}

function PaginationPreview() {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  return <Stack><Example title="Page, size and total"><TablePagination page={page} pageSize={pageSize} total={58} noun="assistant" onPageChange={setPage} onPageSizeChange={(value) => { setPageSize(value); setPage(1); }} className="px-0" /></Example><Example title="Count-only and empty"><TablePagination total={3} noun="assistant" className="px-0" /><TablePagination total={0} noun="assistant" className="px-0" /></Example></Stack>;
}

function TableOpenPreview() {
  return <Stack><Example title="Reveal on row hover or keyboard focus"><div className="group/row rounded-lg border border-alpha-medium p-4"><TableOpenCell href="/components/table" label="Table component">Knowledge collection</TableOpenCell></div><p className="text-xs text-muted-foreground">Hover this row or Tab to reveal the Open control.</p></Example></Stack>;
}

function TableSelectionPreview() {
  const selection = useRowSelection(TABLE_ROWS.map((row) => row.id));
  const [message, setMessage] = useState("");
  return <Stack><Example title="None, some and all selected" wide><TableBulkBar count={selection.count} noun="assistant" onClear={selection.clear}><Button variant="outline" size="sm" onClick={() => setMessage(`${selection.count} assistants selected for export.`)}>Export</Button></TableBulkBar><Table><TableHeader><TableRow><SelectAllHead state={selection.allState} onToggle={selection.toggleAll} /><TableHead>Name</TableHead></TableRow></TableHeader><TableBody>{TABLE_ROWS.map((row) => <TableRow key={row.id}><SelectRowCell checked={selection.isSelected(row.id)} onToggle={() => selection.toggle(row.id)} label={row.name} /><TableCell>{row.name}</TableCell></TableRow>)}</TableBody></Table><p role="status" className="text-xs text-muted-foreground">{message || `${selection.count} selected.`}</p></Example></Stack>;
}

function MotionTablePreview() {
  const [empty, setEmpty] = useState(false);
  const rows = empty ? [] : TABLE_ROWS;
  return <Stack><Example title="Read-only sortable data" wide><MotionTable noun="assistant" data={rows} getRowId={(row) => row.id} columns={[{ key: "name", header: "Name", accessor: (row) => row.name, sortable: true }, { key: "documents", header: "Documents", accessor: (row) => row.documents, sortable: true, align: "right" }]} emptyState="No assistants match this view." /><Button variant="outline" size="sm" onClick={() => setEmpty((value) => !value)}>{empty ? "Restore rows" : "Show empty state"}</Button></Example></Stack>;
}

function AvailabilityPreview() {
  const [hours, setHours] = useState<WeekHours>({ monday: { enabled: true, ranges: [{ id: "catalog-mon", opensHour: 9, opensMinute: 0, closesHour: 17, closesMinute: 0 }] }, tuesday: { enabled: false, ranges: [] }, wednesday: { enabled: false, ranges: [] }, thursday: { enabled: false, ranges: [] }, friday: { enabled: false, ranges: [] }, saturday: { enabled: false, ranges: [] }, sunday: { enabled: false, ranges: [] } });
  return <Stack><Example title="Weekly opening hours" wide><AvailabilityScheduler value={hours} onChange={setHours} /></Example></Stack>;
}

const CATALOG_PEOPLE: Assignee[] = [{ id: "alex", name: "Alex", seed: "catalog-alex" }, { id: "sam", name: "Sam", seed: "catalog-sam" }, { id: "nora", name: "Nora", seed: "catalog-nora", animated: true, note: "Research teammate" }, { id: "morgan", name: "Morgan", seed: "catalog-morgan" }];

function UserAvatarPreview() {
  return <Stack><Example title="Known person, email and unknown identity"><div className="flex items-center gap-4"><UserAvatar avatarUrl="/bloub/happy.svg" size="size-12" /><UserAvatar userId="catalog-alex" size="size-12" /><UserAvatar email="sam@example.test" size="size-12" /><UserAvatar size="size-12" /></div></Example></Stack>;
}

function TeammateAvatarPreview() {
  return <Stack><Example title="Teammate and Ciele AI"><div className="flex items-center gap-4"><TeammateAvatar teammate={{ id: "nora", name: "Nora", avatarSeed: "catalog-nora" }} className="size-12" /><TeammateAvatar teammate={{ id: "ciele", name: "Ciele AI", avatarSeed: "ciele-ai", systemKind: "ciele_ai" }} className="size-12" /></div></Example></Stack>;
}

function GroupAvatarPreview() {
  return <Stack><Example title="Compact, default and empty groups"><div className="flex items-center gap-6"><GroupAvatarCluster faces={CATALOG_PEOPLE} participantCount={5} size="sm" /><GroupAvatarCluster faces={CATALOG_PEOPLE} participantCount={5} /><GroupAvatarCluster faces={[]} participantCount={0} /></div></Example></Stack>;
}

function AssigneesPreview() {
  const [assigned, setAssigned] = useState<Assignee[]>(CATALOG_PEOPLE.slice(0, 2));
  const groups = [{ label: "People and teammates", items: CATALOG_PEOPLE.filter((person) => !assigned.some((entry) => entry.id === person.id)), empty: "Everybody is already here.", onPick: async (person: Assignee) => setAssigned((current) => [...current, person]) }];
  return <TooltipProvider><Stack><Example title="Members, search and add"><div className="flex flex-wrap items-center gap-6"><Assignees assigned={assigned} groups={groups} label="Preview assignees" /><Assignees assigned={assigned} stack="Grid" groups={groups} label="Preview assignees in a grid" /></div><Button variant="ghost" size="sm" onClick={() => setAssigned(CATALOG_PEOPLE.slice(0, 2))}>Reset assignees</Button><p role="status" className="text-xs text-muted-foreground">{assigned.length} members assigned.</p></Example></Stack></TooltipProvider>;
}

function FeatherPreview() {
  return <Stack><Example title="Feather mark"><div className="flex items-center gap-6"><FeatherIcon size={20} /><FeatherIcon size={32} /><FeatherIcon size={48} /></div></Example></Stack>;
}

function FlowIconPreview() {
  const [selected, setSelected] = useState("none");
  return <Stack><Example title="Flow action symbols"><div className="flex flex-wrap gap-2">{FLOW_BUTTON_ICON_OPTIONS.map((option) => <Button key={option.value} variant="outline" onClick={() => setSelected(option.label)}><FlowButtonIcon icon={option.value} />{option.label}</Button>)}</div><p role="status" className="text-xs text-muted-foreground">{selected === "none" ? "Choose an icon." : `${selected} selected.`}</p></Example></Stack>;
}

function SidebarIconPreview() {
  const [leftOpen, setLeftOpen] = useState(false);
  const [rightOpen, setRightOpen] = useState(false);
  return <Stack><Example title="Left and right panel states"><div className="flex flex-wrap gap-2"><Button variant="outline" aria-pressed={leftOpen} onClick={() => setLeftOpen((value) => !value)}><SidebarToggleIcon isOpen={leftOpen} />{leftOpen ? "Close left panel" : "Open left panel"}</Button><Button variant="outline" aria-pressed={rightOpen} onClick={() => setRightOpen((value) => !value)}><SidebarToggleIcon isOpen={rightOpen} side="right" />{rightOpen ? "Close right panel" : "Open right panel"}</Button></div></Example></Stack>;
}

function BotIconPreview() {
  const [pressed, setPressed] = useState(false);
  return <Stack><Example title="Local assistant glyph"><Button variant="outline" onClick={() => setPressed((value) => !value)}><AnimatedGlyph icon={BotIcon} size={20} />{pressed ? "Assistant selected" : "Assistant"}</Button></Example></Stack>;
}

function CodeBlockPreview() {
  return <Stack><Example title="Plain and tabbed examples" wide><CodeBlock code={'<Button variant="outline">Open</Button>'} language="tsx" /><CodeBlock tabs={[{ label: "TypeScript", language: "typescript", code: 'const title = "Support assistant";' }, { label: "JSON", language: "json", code: '{ "title": "Support assistant" }' }]} /></Example></Stack>;
}

function AgentCodePreview() {
  return <Stack><Example title="Highlighted code without chrome" wide><AgentCode code={'{\n  "status": "ready",\n  "documents": 24\n}'} language="json" /></Example></Stack>;
}

function AgentCodeBlockPreview() {
  return <Stack><Example title="Highlighted chat code" wide><AgentCodeBlock code={'const answer = {\n  text: "Hello",\n  sources: [],\n};'} language="typescript" /></Example></Stack>;
}

function RollingNumberPreview() {
  const [count, setCount] = useState(1248);
  return <Stack><Example title="Counts and percentages"><div className="flex flex-wrap items-center gap-6"><span className="text-3xl font-medium tabular-nums"><RollingNumber value={count} /></span><span className="text-3xl font-medium tabular-nums"><RollingNumber value={92.4} format="percent" /></span></div><div className="flex gap-2"><Button variant="outline" size="sm" onClick={() => setCount((value) => value - 50)}>−50</Button><Button variant="outline" size="sm" onClick={() => setCount((value) => value + 50)}>+50</Button></div></Example></Stack>;
}

function ShimmerPreview() {
  return <Stack><Example title="Generation status"><TextShimmer className="text-lg">Searching knowledge…</TextShimmer></Example></Stack>;
}

function RollRowPreview() {
  const [replay, setReplay] = useState(0);
  return <Stack><Example title="A row entrance policy"><div key={replay} className="space-y-2">{[{ text: "First row · rolls in", index: 0 }, { text: "Second row · rolls in", index: 1 }, { text: "Eleventh row · appears immediately", index: 10 }].map(({ text, index }) => <RollRow index={index} key={text}><p className="text-sm"><RollInText text={text} /></p></RollRow>)}</div><Button variant="outline" size="sm" onClick={() => setReplay((value) => value + 1)}>Replay entrance</Button></Example></Stack>;
}

function PageRevealPreview() {
  const [replay, setReplay] = useState(0);
  return <Stack><Example title="Staged content entrance"><PageReveal key={replay}><div className="space-y-3">{["Knowledge", "Flows", "Conversations"].map((title) => <p key={title} className="text-sm">{title}</p>)}</div></PageReveal><Button variant="outline" size="sm" onClick={() => setReplay((value) => value + 1)}>Replay entrance</Button></Example></Stack>;
}

function SkeletonRevealPreview() {
  const [loading, setLoading] = useState(true);
  return <Stack><Example title="Skeleton gives way to content"><SkeletonReveal loading={loading} skeleton={<Skeleton className="h-24 w-full" />}><div className="flex min-h-24 items-center text-sm">Your connected knowledge is ready.</div></SkeletonReveal><Button variant="outline" size="sm" onClick={() => setLoading((value) => !value)}>{loading ? "Reveal content" : "Show skeleton"}</Button></Example></Stack>;
}

function SoundPreview() {
  const [muted, setMuted] = useState(true);
  return <Stack><Example title="Local sound preference"><FeedbackProvider muted={muted} onMutedChange={setMuted}><SoundSwitcher /></FeedbackProvider><p role="status" className="text-xs text-muted-foreground">{muted ? "Sound is muted." : "Sound is enabled."}</p></Example></Stack>;
}

function AppearancePreview() {
  return <Stack><Example title="Theme and palette settings" wide><ThemeSettingsClient /></Example></Stack>;
}

function SlidePreview() {
  const [confirmed, setConfirmed] = useState(false);
  const [reset, setReset] = useState(0);
  return <Stack><Example title="Drag or confirm with the keyboard"><div className="max-w-full overflow-x-auto pb-2"><SlideToConfirm key={reset} label="Slide to confirm" confirmedLabel="Confirmed" onConfirm={() => setConfirmed(true)} /></div><div className="flex flex-wrap items-center gap-3"><p role="status" className="text-xs text-muted-foreground">{confirmed ? "Preview confirmed." : "Drag the handle or use its arrow keys."}</p><Button variant="ghost" size="sm" onClick={() => { setConfirmed(false); setReset((value) => value + 1); }}>Reset</Button></div></Example></Stack>;
}

function MagneticPreview() {
  const [count, setCount] = useState(0);
  return <Stack><Example title="Pointer attraction"><div className="flex min-h-32 items-center justify-center"><Magnetic maxOffset={12}><Button variant="outline" onClick={() => setCount((value) => value + 1)}>Magnetic control</Button></Magnetic></div><p role="status" className="text-xs text-muted-foreground">{count} clicks in this preview</p></Example></Stack>;
}

function MorphTextPreview() {
  const [research, setResearch] = useState(false);
  return <Stack><Example title="Changing label"><MorphText text={research ? "Research assistant" : "Support assistant"} className="text-xl font-medium" /><Button variant="outline" onClick={() => setResearch((value) => !value)}>Change label</Button></Example></Stack>;
}

function ArcPickerPreview() {
  const [value, setValue] = useState("support");
  return <Stack><Example title="Drag, scroll or use the arrow keys"><ArcPicker aria-label="Assistant role" value={value} onValueChange={setValue} options={[{ value: "support", label: "Support" }, { value: "research", label: "Research" }, { value: "study", label: "Study" }, { value: "unavailable", label: "Unavailable", disabled: true }]} /><p role="status" className="text-xs text-muted-foreground">Selected: {value}</p></Example></Stack>;
}

export default function PrimitivePreview({ slug }: { slug: string }) {
  switch (slug) {
    case "buttons": return <ButtonPreview />;
    case "inputs": return <InputPreview />;
    case "textareas": return <TextareaPreview />;
    case "labels": return <LabelPreview />;
    case "morph-text": return <MorphTextPreview />;
    case "arc-picker": return <ArcPickerPreview />;
    case "switches": return <SwitchPreview />;
    case "checkboxes": return <CheckboxPreview />;
    case "radio-groups": return <RadioPreview />;
    case "selects": return <SelectPreview />;
    case "filters": return <FilterPreview />;
    case "tabs": return <TabsPreview />;
    case "badges": return <BadgePreview />;
    case "cards": return <CardPreview />;
    case "dialogs": return <DialogPreview />;
    case "popovers": return <PopoverPreview />;
    case "menus": return <MenuPreview />;
    case "tooltips": return <TooltipPreview />;
    case "accordions": return <AccordionPreview />;
    case "drawers": return <DrawerPreview />;
    case "bottom-sheets": return <BottomSheetPreview />;
    case "tables": return <TablePreview />;
    case "calendars": return <CalendarPreview />;
    case "color-pickers": return <ColorPreview />;
    case "file-upload": return <UploadPreview />;
    case "sortable-lists": return <SortablePreview />;
    case "list-inputs": return <ListPreview />;
    case "avatars": return <AvatarPreview />;
    case "icons": return <IconPreview />;
    case "empty-states": return <EmptyPreview />;
    case "skeletons": return <SkeletonPreview />;
    case "copy-feedback": return <CopyPreview />;
    case "resizable-panels": return <ResizePreview />;
    case "text-motion": return <TextMotionPreview />;
    case "loading-motion": return <LoadingMotionPreview />;
    case "action-swap": return <ActionPreview />;
    case "tilt-cards": return <TiltPreview />;
    case "grid-beam": return <GridPreview />;
    case "preview-rail": return <RailPreview />;
    case "theme-controls": return <ThemePreview />;
    case "progressive-blur": return <BlurPreview />;
    case "password-input": return <PasswordPreview />;
    case "motion-input": return <MotionInputPreview />;
    case "field-header": return <FieldHeaderPreview />;
    case "section-heading": return <SectionHeadingPreview />;
    case "status-badge": return <StatusBadgePreview />;
    case "source-status-badge": return <SourceStatusPreview />;
    case "trust-badge": return <TrustPreview />;
    case "spotlight-card": return <SpotlightPreview />;
    case "feature-card": return <FeaturePreview />;
    case "feature-card-face": return <FeatureFacePreview />;
    case "morphing-modal": return <MorphingModalPreview />;
    case "morphing-dialog": return <MorphingDialogPreview />;
    case "confirm-delete": return <ConfirmDeletePreview />;
    case "morph-popover": return <MorphPopoverPreview />;
    case "context-menu": return <ContextMenuPreview />;
    case "hover-highlight": return <HoverHighlightPreview />;
    case "table-row-menu": return <TableRowMenuPreview />;
    case "rail-panel": return <RailPanelPreview />;
    case "table": return <NativeTablePreview />;
    case "table-column-header": return <ColumnHeaderPreview />;
    case "table-pagination": return <PaginationPreview />;
    case "table-open-cell": return <TableOpenPreview />;
    case "table-selection": return <TableSelectionPreview />;
    case "motion-table": return <MotionTablePreview />;
    case "availability-scheduler": return <AvailabilityPreview />;
    case "user-avatar": return <UserAvatarPreview />;
    case "teammate-avatar": return <TeammateAvatarPreview />;
    case "group-avatar-cluster": return <GroupAvatarPreview />;
    case "assignees": return <AssigneesPreview />;
    case "feather-icon": return <FeatherPreview />;
    case "flow-button-icon": return <FlowIconPreview />;
    case "sidebar-toggle-icon": return <SidebarIconPreview />;
    case "bot-icon": return <BotIconPreview />;
    case "code-block": return <CodeBlockPreview />;
    case "agent-code": return <AgentCodePreview />;
    case "agent-code-block": return <AgentCodeBlockPreview />;
    case "rolling-number": return <RollingNumberPreview />;
    case "text-shimmer": return <ShimmerPreview />;
    case "roll-row": return <RollRowPreview />;
    case "page-reveal": return <PageRevealPreview />;
    case "skeleton-reveal": return <SkeletonRevealPreview />;
    case "sound-switcher": return <SoundPreview />;
    case "appearance-settings": return <AppearancePreview />;
    case "slide-to-confirm": return <SlidePreview />;
    case "magnetic": return <MagneticPreview />;
    default: throw new Error(`Unknown primitive preview: ${slug}`);
  }
}
