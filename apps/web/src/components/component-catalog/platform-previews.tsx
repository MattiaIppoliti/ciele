"use client";

import { useId, useRef, useState, type ReactNode } from "react";
import { BookOpen, FileText, Folder, Search, RotateCcw, Rows3 } from "lucide-react";
import { Button, Badge, Input, TooltipProvider } from "@agent-hub/ui";
import { modelSelector, type FeedbackReactionId, type MessageReaction, type ModelRef, type ModelSource, type StudyExercise, type StudyFormat, type TurnStep } from "@agent-hub/core";
import { MODEL_CATALOG, MODEL_SOURCE_NAMES } from "@agent-hub/agent/client";
import { ReactFlowProvider } from "@xyflow/react";
import { Message, MessageBubble, MessageBubbleContent, MessageContent, MessageScroller } from "@/components/agents/message";
import { StreamingResponse } from "@/components/agents/streaming-response";
import { PromptInput } from "@/components/agents/prompt-input";
import { Citations, CitationStack, type CitationItem } from "@/components/agents/citations";
import { ToolResult, ToolResultOutput } from "@/components/agents/tool-result";
import { ToolApproval, type ToolApprovalStatus } from "@/components/agents/tool-approval";
import { TodoList, type TodoItem } from "@/components/agents/todo-list";
import { AgentActivity } from "@/components/agents/agent-activity";
import { AISidebar, type SidebarResource } from "@/components/agents/ai-sidebar";
import { ChatMarkdown } from "@/components/chat/chat-markdown";
import { CitationList } from "@/components/chat/citation-list";
import { ThinkingTimeline } from "@/components/chat/thinking-timeline";
import { AgentDisclosure } from "@/components/agents/agent-disclosure";
import { CitationList as AgentCitationList } from "@/components/agents/citations";
import { RadialMenu } from "@/components/assistant/radial-menu";
import { ThinkingPanel } from "@/components/chat/thinking-panel";
import { ProgressLine } from "@/components/chat/progress-line";
import { AttachmentChips, AttachmentDropHint } from "@/components/chat/attachment-chips";
import type { AttachmentEntry } from "@/components/chat/use-attachments";
import { EmojiFeedback } from "@/components/chat/emoji-feedback";
import { ReactionRecord } from "@/components/chat/reaction-record";
import { StudyExerciseReply, STUDY_LABELS } from "@/components/chat/study-exercise";
import { ThinkingOrb } from "@/components/orbs/thinking-orb";
import { ThinkingShimmer } from "@/components/agents/loading-states/thinking-shimmer";
import { FieldHeader } from "@/components/settings/field-header";
import { Switch } from "@/components/ui/motion-switch";
import { Textarea } from "@/components/ui/textarea";
import { AppBrandMark, APP_BRANDS, APP_BRAND_ORDER } from "@/components/ui/app-brand";
import { ProviderBrandIcon } from "@/components/settings/provider-brand-icon";
import { ModelProviderLogo } from "@/components/chat/model-provider-logo";
import { VoiceInputButton } from "@/components/chat/voice-input-button";
import { SpeechPlayback } from "@/components/chat/speech-playback";
import { ChatHeader } from "@/components/chat/chat-header";
import { ComponentReplyPart } from "@/components/chat/component-part";
import { IdentityGate } from "@/components/chat/identity-gate";
import { ModelSourceSelect } from "@/components/chat/model-source-select";
import { ModelAllowList, modelAllowListSummary } from "@/components/chat/model-allow-list";
import { ComposerPulse } from "@/components/chat/composer-pulse";
import { CommandBar } from "@/components/assistant/command-bar";
import { TriggerList, triggerInputProps } from "@/components/chat/trigger-list";
import { StudyMenu } from "@/components/chat/study-menu";
import EmojiPicker from "@/components/chat/emoji-picker";
import { NavTree } from "@/components/shell/nav-tree";
import { FindRow, type FindItem } from "@/components/shell/find-row";
import { IntentLink } from "@/components/ui/intent-link";
import { SectionTimeline, TimelineSection } from "@/components/settings/section-timeline";
import { MotionNavigationMenu } from "@/components/home/motion-navigation-menu";
import { GhostMark } from "@/components/auth/ghost-mark";
import { GithubMark } from "@/components/home/github-mark";
import { toast } from "@/lib/toast";
import { CieleAiLogo, CieleAiPeek } from "@/components/teammates/ciele-ai-logo";
import AICitation from "@/components/smoothui/ai-citation";
import { CanvasToolbar } from "@/components/assistant/canvas-toolbar";
import { FlowCanvasField } from "@/components/assistant/flow-canvas-field";
import { NotificationStack } from "@/components/motion/notification-stack";
import { Breadcrumb, BreadcrumbList, BreadcrumbItem, BreadcrumbLink, BreadcrumbPage, BreadcrumbSeparator } from "@/components/motion/breadcrumb";
import { RollInText } from "@/components/motion/roll-in-text";
import { ChartsPreview, MetricCardsPreview, GaugesPreview } from "./platform-charts";

function Example({ title, children, description }: { title: string; children: ReactNode; description?: string }) {
  return <section className="min-w-0 space-y-3"><div><h3 className="text-sm font-medium">{title}</h3>{description && <p className="mt-1 text-xs text-muted-foreground">{description}</p>}</div>{children}</section>;
}

const SOURCES: CitationItem[] = [{ id: "policy", title: "Account policy", domain: "Knowledge collection" }, { id: "guide", title: "Getting started", domain: "Product guide" }, { id: "faq", title: "Frequently asked questions", domain: "Help center" }];
const ANSWER = "You can invite a teammate from **Settings → Members**.\n\n1. Choose **Invite member**.\n2. Enter their email address.\n3. Select the role and send the invitation.\n\nThe invitation gives them access to your organization.";
const REPLY_EXERCISE: StudyExercise = { id: "reply-example", title: "Organization roles", format: "multiple_choice", questions: [{ id: "role", prompt: "Which role can manage settings?", options: ["Admin", "Viewer"] }], answers: [{ questionId: "role", answer: "Admin", correct: true, correctAnswer: "Admin", explanation: "An Admin can manage settings and member access." }] };

function ReplyPartsPreview() {
  const [question, setQuestion] = useState("");
  return (
    <Example title="Reply components" description="Tables can expose follow-up questions; study replies show a saved result.">
      <ComponentReplyPart part={{ type: "component", action: "search_knowledge", name: "table", callId: "catalog-table", props: { title: "Organization roles", columns: ["Role", "Access"], rows: [["Admin", "Settings and members"], ["Viewer", "Read-only access"]], askAbout: ["How do I assign an Admin?", "What can a Viewer see?"], caption: "Sample organization permissions" } }} onAsk={setQuestion} />
      <p aria-live="polite" className="text-xs text-muted-foreground">{question ? `Selected follow-up: ${question}` : "Choose a row’s follow-up question."}</p>
      <ComponentReplyPart part={{ type: "component", action: "search_knowledge", name: "study_exercise", callId: "catalog-study", props: { exercise: REPLY_EXERCISE } }} />
    </Example>
  );
}

function IdentityPreview() {
  const [state, setState] = useState<"ready" | "loading" | "unavailable" | "signed-in">("ready");
  return (
    <Example title="Identity gate" description="Preview the sign-in surface and its loading and unavailable states.">
      <div className="flex flex-wrap gap-2">{(["ready", "loading", "unavailable"] satisfies Array<typeof state>).map((next) => <Button key={next} variant="outline" size="sm" aria-pressed={state === next} onClick={() => setState(next)}>{next === "ready" ? "Ready" : next === "loading" ? "Loading" : "Unavailable"}</Button>)}</div>
      <div className="relative flex h-96 items-center justify-center overflow-hidden rounded-xl border bg-background">
        {state === "signed-in" ? <p role="status" className="text-sm text-muted-foreground">Sample sign-in completed. Choose a state to restore the gate.</p> : <IdentityGate provider={state === "unavailable" ? null : "entra"} loading={state === "loading"} onLogin={() => setState("signed-in")} brandColor="var(--brand)" />}
      </div>
    </Example>
  );
}

function MessagesPreview({ slug }: { slug: string }) {
  const [feedback, setFeedback] = useState<FeedbackReactionId | null>(null);
  const [replay, setReplay] = useState(0);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [headerMessage, setHeaderMessage] = useState("");
  const [streaming, setStreaming] = useState(false);
  const header = <ChatHeader nickname="Ciele" historyOpen={historyOpen} onToggleHistory={() => setHistoryOpen(!historyOpen)} historyMenu={<div className="space-y-2 p-4 text-sm"><p>Sample conversation history</p><Button variant="ghost" size="sm" onClick={() => { setHeaderMessage("Planning conversation selected"); setHistoryOpen(false); }}>Planning the release</Button></div>} onNewChat={() => { setReplay(replay + 1); setHeaderMessage("Sample conversation restarted"); }} fullscreen={expanded} onToggleFullscreen={() => { setExpanded(!expanded); setHeaderMessage(expanded ? "Compact chat selected" : "Fullscreen chat selected"); }} onSendFeedback={() => setHeaderMessage("Feedback action selected in this preview")} />;
  const answer = <StreamingResponse status={slug === "streaming-response" && streaming ? "streaming" : "complete"} copyText={ANSWER} sources={SOURCES} feedback={feedback} onFeedbackChange={setFeedback}><ChatMarkdown text={ANSWER} /></StreamingResponse>;
  if (slug === "chat-markdown") return <div className="w-full max-w-xl text-sm"><ChatMarkdown text={ANSWER + "\n\n```typescript\nconst role = 'Admin';\n```"} /></div>;
  if (slug === "chat-header") return <div className="w-full max-w-2xl space-y-3"><div className="rounded-xl border bg-background">{header}</div><p aria-live="polite" className="text-xs text-muted-foreground">{headerMessage || "Try history, new chat or fullscreen."}</p></div>;
  if (slug === "streaming-response") return <div className="w-full max-w-xl space-y-4"><Button variant="outline" size="sm" onClick={() => setStreaming(!streaming)}>{streaming ? "Complete answer" : "Show streaming state"}</Button>{answer}</div>;
  if (slug === "chat-messages") return <div className="w-full max-w-xl space-y-5"><Message from="user"><MessageContent>How do I invite a teammate?</MessageContent></Message><Message from="assistant"><MessageContent>Choose Invite member in Settings.</MessageContent></Message></div>;
  if (slug === "message-bubble") return <div className="w-full max-w-xl space-y-5"><Message from="user"><MessageBubble><MessageBubbleContent>How do I invite a teammate?</MessageBubbleContent></MessageBubble></Message><Message from="assistant"><MessageBubble><MessageBubbleContent>Choose Invite member in Settings.</MessageBubbleContent></MessageBubble></Message></div>;
  return <div className="w-full max-w-2xl space-y-4"><Button variant="outline" size="sm" onClick={() => setReplay(replay + 1)}>Replay entrance</Button><div className="overflow-hidden rounded-xl border bg-background">{slug === "conversation" && header}<MessageScroller key={replay} label="Sample conversation" navigation="rail" followOutput={false} className={expanded ? "h-96" : "h-80"} contentClassName="space-y-5 p-5"><Message from="user" animateIn><MessageBubble><MessageBubbleContent>How do I invite a teammate?</MessageBubbleContent></MessageBubble></Message><Message from="assistant" animateIn><MessageContent>{answer}</MessageContent></Message><Message from="user"><MessageBubble><MessageBubbleContent>Can I change their role later?</MessageBubbleContent></MessageBubble></Message><Message from="assistant"><MessageContent>Yes. Open the member’s row in Settings and choose the new role.</MessageContent></Message></MessageScroller></div><p aria-live="polite" className="text-xs text-muted-foreground">{headerMessage || "Scroll the transcript or use its message navigation rail."}</p></div>;
}

function ModelChoicesPreview({ slug }: { slug: string }) {
  const [source, setSource] = useState<ModelSource | null>(null);
  const [allowed, setAllowed] = useState<ModelRef[]>([]);
  const configuredModel = MODEL_CATALOG.google[0];
  const configured: ModelRef = { provider: "google", modelId: configuredModel?.id ?? "gemini-2.5-flash" };
  const sources: ModelSource[] = ["platform", "api_key", "platform_gateway"];
  return <div className="w-full max-w-xl space-y-4"><p className="text-sm">Configured model: {configuredModel?.label ?? "Sample Google model"}</p>{slug !== "model-allow-list" && <><ModelSourceSelect sources={sources} value={source} onChange={setSource} /><p aria-live="polite" className="text-xs text-muted-foreground">Source: {source ? MODEL_SOURCE_NAMES[source] : "Automatic"}</p></>}{slug !== "model-source-select" && <><ModelAllowList configured={configured} value={allowed} onChange={setAllowed} sources={{ [modelSelector(configured)]: sources }} /><p aria-live="polite" className="text-xs text-muted-foreground">{modelAllowListSummary(allowed)}</p></>}</div>;
}

function ComposerPreview({ slug }: { slug: string }) {
  const [draft, setDraft] = useState("");
  const [submitted, setSubmitted] = useState("");
  const [model, setModel] = useState("auto");
  const [busy, setBusy] = useState(true);
  const [highlighted, setHighlighted] = useState(0);
  const [triggerOpen, setTriggerOpen] = useState(false);
  const listId = useId();
  const commands = [{ id: "search", label: "Search knowledge" }, { id: "summarize", label: "Summarize a document" }, { id: "study", label: "Create a study exercise" }];
  function chooseCommand(index: number) {
    const command = commands[index];
    if (!command) return;
    setDraft(command.label);
    setTriggerOpen(false);
  }
  if (slug === "command-bar") return <div className="w-full max-w-2xl space-y-4"><CommandBar width="100%" label="Sample canvas command" placeholder="Describe a flow…" onSubmit={setSubmitted} /><p aria-live="polite" className="text-xs text-muted-foreground">{submitted ? `Sample command: ${submitted}` : "Describe a flow and submit the command."}</p></div>;
  if (slug === "trigger-list") return <div className="w-full max-w-xl space-y-4"><div className="pt-40"><div className="relative">{triggerOpen && <TriggerList id={listId} label="Sample commands" items={commands} highlighted={highlighted} onHighlight={setHighlighted} onPick={(item) => { setDraft(item.label); setTriggerOpen(false); }} renderItem={(item) => <span>{item.label}</span>} />}<Input value={draft} onChange={(event) => setDraft(event.target.value)} aria-label="Sample command trigger" {...triggerInputProps(listId, triggerOpen, highlighted)} placeholder="Focus for command suggestions" onFocus={() => setTriggerOpen(true)} onKeyDown={(event) => { if (event.key === "Escape") setTriggerOpen(false); if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); setTriggerOpen(true); setHighlighted((current) => (current + (event.key === "ArrowDown" ? 1 : -1) + commands.length) % commands.length); } if (event.key === "Enter" && triggerOpen) { event.preventDefault(); chooseCommand(highlighted); } }} /></div></div><p aria-live="polite" className="text-xs text-muted-foreground">{draft || "Focus the field, then use arrow keys and Enter."}</p></div>;
  if (slug === "composer-pulse") return <div className="w-full max-w-xl space-y-4"><Button variant="outline" size="sm" onClick={() => setBusy(!busy)}>{busy ? "Finish sample work" : "Start sample work"}</Button><ComposerPulse loading={busy}><div className="rounded-2xl border p-4 text-sm">{busy ? "Reviewing the sample document…" : "Review completed"}</div></ComposerPulse></div>;
  return <div className="w-full max-w-2xl space-y-6"><PromptInput value={draft} onValueChange={setDraft} model={model} onModelChange={setModel} models={[{ value: "auto", label: "Auto", description: "Selects the right model", separatorAfter: true }, { value: "fast", label: "Fast", description: "Quick conversational replies" }, { value: "reasoning", label: "Reasoning", description: "Complex tasks" }]} actions={[{ value: "sample", label: "Insert sample question", icon: <BookOpen className="size-4" /> }]} onAction={() => setDraft("How do I invite a teammate?")} onSubmit={(value) => { setSubmitted(value); setDraft(""); }} placeholder="Ask Ciele…" /><p aria-live="polite" className="text-xs text-muted-foreground">{submitted ? `Sample submitted: ${submitted}` : "Type a message or insert the sample question."}</p><Example title="Busy and stop states"><ComposerPulse loading={busy}><PromptInput loading={busy} value={busy ? "Reviewing the sample document…" : "Sample generation stopped"} onStop={() => setBusy(false)} disabled={!busy} /></ComposerPulse>{!busy && <Button variant="outline" size="sm" onClick={() => setBusy(true)}>Restore busy state</Button>}</Example></div>;
}

function CitationsPreview({ slug }: { slug: string }) {
  if (slug === "citation-stack") return <div className="flex items-center gap-3"><CitationStack citations={SOURCES} /><span className="text-sm text-muted-foreground">Three supporting sources</span></div>;
  if (slug === "citation-list") return <div className="w-full max-w-xl"><AgentCitationList citations={SOURCES} /></div>;
  if (slug === "transcript-citations") return <div className="w-full max-w-xl"><CitationList sources={SOURCES.map((source) => ({ conceptTitle: String(source.title), collectionName: "Organization knowledge", sourceName: String(source.domain) }))} collapsible /></div>;
  if (slug === "inline-citation") return <p className="text-sm leading-7">Invitations inherit the chosen organization role. <AICitation label={1} title="Account policy" description="Organization roles define which pages and actions a member can access." favicon={<BookOpen className="size-4" />} /></p>;
  return <div className="w-full max-w-xl"><Citations citations={SOURCES} defaultOpen /></div>;
}

const TRACE: TurnStep[] = [{ id: "search", kind: "tool", tool: "searchKnowledge", label: "Searching organization knowledge", status: "done", input: { query: "invite teammate" }, detail: "3 relevant concepts found", durationMs: 480 }, { id: "read", kind: "tool", tool: "readKnowledgeSource", label: "Reading the account policy", status: "done", detail: "Invitation and role instructions", durationMs: 320 }];

function ThinkingPreview({ slug }: { slug: string }) {
  const [active, setActive] = useState(false);
  const steps = active ? [...TRACE, { id: "write", kind: "thought", label: "Preparing a grounded answer", status: "running", detail: "Combining the invitation steps with the role guidance." } satisfies TurnStep] : TRACE;
  if (slug === "thinking-orb") return <div className="flex flex-wrap gap-5">{(["working", "searching", "solving", "connecting"] satisfies Array<"working" | "searching" | "solving" | "connecting">).map((state) => <span key={state} className="flex items-center gap-2 text-xs text-muted-foreground"><ThinkingOrb state={state} />{state}</span>)}</div>;
  if (slug === "thinking-shimmer") return <ThinkingShimmer>Thinking…</ThinkingShimmer>;
  if (slug === "progress-line") return <div className="space-y-4"><Button variant="outline" size="sm" onClick={() => setActive(!active)}>Update progress</Button><ProgressLine text={active ? "I’m preparing the answer from the policy." : "I found the policy. I’m checking the invitation steps."} /></div>;
  return <div className="w-full max-w-2xl space-y-5"><Button variant="outline" size="sm" onClick={() => setActive(!active)}>{active ? "Complete sample turn" : "Show active turn"}</Button>{slug === "thinking-timeline" ? <TooltipProvider><ThinkingTimeline steps={steps} /></TooltipProvider> : slug === "agent-activity" ? <AgentActivity items={[{ id: "sample", type: "text", content: "Checking the source and preparing the response." }]} status={active ? "working" : "complete"} duration={2} /> : <ThinkingPanel steps={steps} phase={active ? "running" : "done"} searchCount={2} active={active} summaryLabel="Thought for 1.8s" />}</div>;
}

function ToolsPreview({ slug }: { slug: string }) {
  const [status, setStatus] = useState<ToolApprovalStatus>("pending");
  const [open, setOpen] = useState(true);
  if (slug === "agent-disclosure") return <div className="w-full max-w-xl space-y-4"><Button variant="outline" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? "Collapse output" : "Reveal output"}</Button><AgentDisclosure open={open}><p className="rounded-xl border p-4 text-sm">Three matching concepts were found in organization knowledge.</p></AgentDisclosure></div>;
  if (slug === "tool-approval") return <div className="w-full max-w-xl space-y-4"><ToolApproval tool="members.invite" title="Invite a teammate" description="This sample approval changes the card state." status={status} onApprove={() => setStatus("approved")} onDeny={() => setStatus("denied")} />{status !== "pending" && <Button variant="outline" size="sm" onClick={() => setStatus("pending")}>Reset approval</Button>}</div>;
  return <div className="w-full max-w-2xl space-y-5"><ToolResult tool="searchKnowledge" title="Search organization knowledge" icon={<Search className="size-4" />} status="success" meta="0.5s" defaultOpen copyText='{"concepts":3}'><ToolResultOutput language="json">{'{\n  "concepts": 3,\n  "source": "Account policy"\n}'}</ToolResultOutput></ToolResult><ToolResult tool="queryApi" title="External endpoint unavailable" icon={<Search className="size-4" />} status="error" defaultOpen={false}><ToolResultOutput language="text">Sample error: request timed out.</ToolResultOutput></ToolResult><ToolResult tool="readKnowledgeSource" title="Reading the policy" icon={<Search className="size-4" />} status="running">Reading account policy…</ToolResult><ToolResult tool="queryApi" title="Request cancelled" icon={<Search className="size-4" />} status="cancelled">The request was cancelled.</ToolResult></div>;
}

const ATTACHMENTS: AttachmentEntry[] = [{ id: "ready", state: "ready", name: "account-policy.pdf", chars: 4820, token: "catalog-sample" }, { id: "reading", state: "reading", name: "screenshot.png" }, { id: "failed", state: "failed", name: "unsupported.zip", message: "Unsupported file type" }];

function AttachmentsPreview({ slug }: { slug: string }) {
  const [entries, setEntries] = useState(ATTACHMENTS);
  if (slug === "attachment-drop-hint") return <div className="relative h-24 w-full max-w-xl"><AttachmentDropHint label="Drop a file here" /></div>;
  return <div className="w-full max-w-2xl space-y-4"><AttachmentChips entries={entries} onRemove={(id) => setEntries(entries.filter((entry) => entry.id !== id))} />{entries.length === 0 && <p role="status" className="text-sm text-muted-foreground">No files attached.</p>}<Button variant="outline" size="sm" onClick={() => setEntries(ATTACHMENTS)}>Restore chips</Button></div>;
}

function ReactionsPreview({ slug }: { slug: string }) {
  const [feedback, setFeedback] = useState<FeedbackReactionId | null>(null);
  const [pickerOpen, setPickerOpen] = useState(true);
  const [selected, setSelected] = useState<string[]>([]);
  const reactions: MessageReaction[] = [{ organizationId: "catalog", messageId: "sample", channelMessageId: null, actorId: "alex", actorName: "Alex", emoji: "🙌" }, { organizationId: "catalog", messageId: "sample", channelMessageId: null, actorId: "sam", actorName: "Sam", emoji: "💡" }, ...selected.map((emoji) => ({ organizationId: "catalog", messageId: "sample", channelMessageId: null, actorId: "you", actorName: "You", emoji }))];
  if (slug === "reaction-record") return <div className="space-y-4"><ReactionRecord reactions={reactions} /><Button variant="outline" size="sm" onClick={() => setSelected(selected.length ? [] : ["🙌"])}>{selected.length ? "Remove your reaction" : "Add your reaction"}</Button></div>;
  if (slug === "emoji-picker") return <div className="w-full max-w-sm space-y-3">{pickerOpen ? <div className="overflow-hidden rounded-xl border bg-popover"><EmojiPicker selected={selected} disabled={false} onBack={() => setPickerOpen(false)} onSelect={(emoji) => setSelected((current) => current.includes(emoji) ? current.filter((entry) => entry !== emoji) : [...current, emoji])} /></div> : <Button variant="outline" onClick={() => setPickerOpen(true)}>Open emoji picker</Button>}<p aria-live="polite" className="text-sm text-muted-foreground">{selected.length ? `Selected: ${selected.join(" ")}` : "Choose an emoji."}</p></div>;
  return <div className="flex w-full max-w-lg items-center gap-4"><p className="flex-1 text-sm">Was this answer useful?</p><EmojiFeedback value={feedback} onChange={setFeedback} /></div>;
}

function StudyPreview({ slug }: { slug: string }) {
  const [completed, setCompleted] = useState(true);
  const [prefix, setPrefix] = useState("");
  const formats: StudyFormat[] = ["multiple_choice", "drag_words", "true_false", "flashcards"];
  if (slug === "study-menu") return <div className="flex items-center gap-3"><StudyMenu settings={{ enabled: true, formats, instructions: "" }} onSelect={setPrefix} /><p aria-live="polite" className="text-xs text-muted-foreground">{prefix ? `Sample command: ${prefix}` : "Choose a study format."}</p></div>;
  return <div className="w-full space-y-5"><Button variant="outline" size="sm" onClick={() => setCompleted(!completed)}>{completed ? "Show unfinished results" : "Show completed results"}</Button><div className="grid gap-5 @2xl:grid-cols-2">{formats.map((format) => { const exercise: StudyExercise = { id: format, title: "Organization roles", format, questions: [{ id: "question", prompt: "Which role can manage the organization settings?", options: ["Admin", "Viewer", "Guest"] }], answers: completed ? [{ questionId: "question", answer: "Admin", correct: true, correctAnswer: "Admin", explanation: "An Admin can manage settings and member access." }] : [] }; return <Example key={format} title={STUDY_LABELS[format]}><StudyExerciseReply exercise={exercise} /></Example>; })}</div></div>;
}

function TasksPreview() {
  const [step, setStep] = useState(1);
  const labels = ["Read the request", "Find relevant sources", "Prepare the answer"];
  const items: TodoItem[] = labels.map((title, index) => ({ id: title, title, status: index < step ? "completed" : index === step ? "in-progress" : "pending" }));
  return <div className="w-full max-w-xl space-y-5"><div className="flex gap-2"><Button variant="outline" size="sm" onClick={() => setStep(Math.min(3, step + 1))} disabled={step === 3}>Complete next step</Button><Button variant="ghost" size="sm" onClick={() => setStep(0)}>Reset</Button></div><TodoList items={items} title="Answer plan" /></div>;
}

function NotificationsPreview({ slug }: { slug: string }) {
  const [open, setOpen] = useState(true);
  const [message, setMessage] = useState("");
  if (slug === "toasts") return <div className="flex flex-wrap gap-2"><Button variant="outline" size="sm" onClick={() => toast.success("Sample changes saved")}>Success toast</Button><Button variant="outline" size="sm" onClick={() => toast.error("Sample request failed")}>Error toast</Button><Button variant="outline" size="sm" onClick={() => toast.warning("Sample review required")}>Warning toast</Button><Button variant="outline" size="sm" onClick={() => toast.info("Sample notification")}>Info toast</Button></div>;
  return <div className="flex min-h-96 w-full flex-col items-center justify-end gap-4 pb-4"><div className="w-full max-w-sm">{open ? <NotificationStack items={[{ id: "ready", title: "Your knowledge is ready", description: "Three documents are available to your assistant.", status: "success", trailing: "Just now" }, { id: "review", title: "An answer needs review", description: "Open Improvements to check the supporting sources.", status: "warning" }, { id: "invite", title: "A teammate joined", description: "The sample organization has a new member.", status: "info" }]} onViewAll={() => setMessage("All sample notifications are visible in this stack.")} onClose={() => setOpen(false)} collapsedLabel="3 notifications" expandedLabel="View all notifications" /> : <Button variant="outline" onClick={() => setOpen(true)}>Restore notifications</Button>}</div><p aria-live="polite" className="text-xs text-muted-foreground">{message || "Hover, focus or press the stack to expand it."}</p></div>;
}

const RESOURCES: SidebarResource[] = [{ id: "knowledge", label: "Knowledge", kind: "folder", children: [{ id: "policy", label: "Account policy.md", kind: "file" }, { id: "guide", label: "Getting started.md", kind: "file" }] }, { id: "threads", label: "Conversations", kind: "folder", children: [{ id: "thread", label: "Planning the release", kind: "file" }, { id: "review", label: "Reviewing the sources", kind: "file" }] }, { id: "archived", label: "Archived document", kind: "file", disabled: true }];

function FileTreePreview() {
  const [activeId, setActiveId] = useState<string | null>("policy");
  return <div className="w-full max-w-md space-y-4 rounded-xl border bg-card p-3"><AISidebar items={RESOURCES} activeId={activeId} onActiveChange={setActiveId} defaultExpandedIds={["knowledge"]} ariaLabel="Sample resource tree" /><p className="border-t px-2 pt-3 text-xs text-muted-foreground">Selected: <RollInText text={activeId ?? "None"} /></p></div>;
}

function NavigationPreview({ slug }: { slug: string }) {
  const [deep, setDeep] = useState(false);
  const [active, setActive] = useState(0);
  const [selected, setSelected] = useState("");
  const listId = useId();
  const [query, setQuery] = useState("");
  const [nickname, setNickname] = useState("Ciele");
  const [suggested, setSuggested] = useState(true);
  const items: FindItem[] = [{ key: "knowledge", label: "Knowledge", hint: "Workspace", group: "Pages", icon: Folder, href: "#knowledge", record: null }, { key: "assistant", label: "Support assistant", hint: "Assistant", group: "Records", icon: BookOpen, href: "#assistant", record: null }, { key: "policy", label: "Account policy", hint: "Source", group: "Records", icon: FileText, href: "#policy", record: null }];
  if (slug === "nav-tree") return <div className="w-full max-w-sm space-y-4" onClickCapture={(event) => { const target = event.target instanceof Element ? event.target.closest("a") : null; if (!target) return; event.preventDefault(); const index = items.findIndex((item) => item.href === target.getAttribute("href")); if (index >= 0) setActive(index); }}><NavTree label="Sample sections" activeIndex={active} items={items.map((item) => ({ label: item.label, href: item.href, icon: item.icon }))} /></div>;
  if (slug === "find-row" || slug === "quick-search") {
    const visible = slug === "find-row" ? items.slice(0, 1) : items.filter((item) => `${item.label} ${item.hint}`.toLowerCase().includes(query.toLowerCase()));
    const activeIndex = Math.min(active, Math.max(0, visible.length - 1));
    return <div className="w-full max-w-lg space-y-3">{slug === "quick-search" && <Input value={query} onChange={(event) => { setQuery(event.target.value); setActive(0); }} aria-label="Sample quick search" aria-controls={listId} aria-activedescendant={visible.length ? `${listId}-${activeIndex}` : undefined} placeholder="Search pages or use arrow keys" onKeyDown={(event) => { if (!visible.length) return; if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); setActive((current) => (current + (event.key === "ArrowDown" ? 1 : -1) + visible.length) % visible.length); } if (event.key === "Enter") setSelected(visible[activeIndex].label); }} />}<div id={listId} role="listbox" aria-label="Sample search results">{visible.map((item, index) => <FindRow key={item.key} item={item} index={index} optionId={`${listId}-${index}`} isActive={activeIndex === index} onMove={(index) => setActive(index)} onSelect={(item) => setSelected(item.label)} />)}{visible.length === 0 && <p className="py-4 text-sm text-muted-foreground">No matching pages.</p>}</div><p aria-live="polite" className="text-xs text-muted-foreground">{selected ? `Selected: ${selected}` : "Choose a result to preview selection."}</p></div>;
  }
  if (slug === "intent-link") return <div className="space-y-3"><IntentLink href={{ pathname: "/components/navigation", hash: "example" }} onClick={(event) => { event.preventDefault(); setSelected("Intent link selected"); }} className="press-text inline-flex text-sm text-brand-ink">Select a sample destination</IntentLink><p aria-live="polite" className="text-xs text-muted-foreground">{selected}</p></div>;
  if (slug === "settings-sections") return <form className="w-full max-w-2xl" onSubmit={(event) => { event.preventDefault(); setSelected(`Saved ${nickname || "assistant"} settings in this preview.`); }}><SectionTimeline><TimelineSection title="Identity"><div className="space-y-2"><FieldHeader title="Nickname" hint="Shown in the chat header." /><Input aria-label="Assistant nickname" value={nickname} onChange={(event) => setNickname(event.target.value)} /></div></TimelineSection><TimelineSection title="Conversation"><div className="flex items-start justify-between gap-6"><FieldHeader title="Suggested questions" hint="Offer relevant follow-up questions after an answer." /><Switch aria-label="Suggested questions" checked={suggested} onCheckedChange={setSuggested} /></div></TimelineSection><TimelineSection title="Review"><p className="text-sm text-muted-foreground">{nickname || "Assistant"} will show {suggested ? "suggested questions" : "answers without follow-up suggestions"}.</p><div className="mt-4 flex items-center gap-3"><Button type="submit">Save changes</Button><span aria-live="polite" className="text-xs text-muted-foreground">{selected}</span></div></TimelineSection></SectionTimeline></form>;
  if (slug === "marketing-navigation") return <div className="relative flex min-h-24 w-full flex-wrap items-start"><MotionNavigationMenu scrolled={false} /></div>;
  return <div className="w-full max-w-2xl space-y-4"><Button variant="outline" size="sm" onClick={() => setDeep(!deep)}>{deep ? "Shorten breadcrumb" : "Show nested path"}</Button><Breadcrumb><BreadcrumbList maxItems={4}><BreadcrumbItem key="home"><BreadcrumbLink href="#navigation-preview" onClick={(event) => event.preventDefault()}>Ciele</BreadcrumbLink></BreadcrumbItem><BreadcrumbItem key="knowledge"><BreadcrumbSeparator /><BreadcrumbLink href="#navigation-preview" onClick={(event) => event.preventDefault()}><Folder />Knowledge</BreadcrumbLink></BreadcrumbItem>{deep && <BreadcrumbItem key="collections"><BreadcrumbSeparator /><BreadcrumbLink href="#navigation-preview" onClick={(event) => event.preventDefault()}>Collections</BreadcrumbLink></BreadcrumbItem>}{deep && <BreadcrumbItem key="policies"><BreadcrumbSeparator /><BreadcrumbLink href="#navigation-preview" onClick={(event) => event.preventDefault()}>Policies</BreadcrumbLink></BreadcrumbItem>}<BreadcrumbItem key="document"><BreadcrumbSeparator /><BreadcrumbPage><FileText />Account policy</BreadcrumbPage></BreadcrumbItem></BreadcrumbList></Breadcrumb></div>;
}

function EditorsPreview({ slug }: { slug: string }) {
  const root = useRef<HTMLDivElement>(null);
  const [tool, setTool] = useState<"select" | "hand">("select");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [zoom, setZoom] = useState(100);
  const [draft, setDraft] = useState("## Answering style\n\nUse concise language and cite the source for each factual answer.");
  const [layout, setLayout] = useState("Auto layout");
  const controls = [{ label: "Auto layout", icon: Rows3, run: () => setLayout("Auto layout selected") }, { label: "Reset", icon: RotateCcw, run: () => { setZoom(100); setLayout("Canvas reset"); } }];
  if (slug === "markdown-editor") return <div className="grid w-full gap-5 @2xl:grid-cols-2"><Example title="Markdown draft"><Textarea aria-label="Sample markdown draft" value={draft} onChange={(event) => setDraft(event.target.value)} rows={7} /></Example><Example title="Rendered draft"><div className="text-sm"><ChatMarkdown text={draft} /></div></Example></div>;
  if (slug === "radial-menu") return <div className="w-full space-y-4"><div className="flex h-48 items-end pl-5"><RadialMenu actions={controls} onOpen={() => setLayout("Choose a canvas action")} /></div><p aria-live="polite" className="text-xs text-muted-foreground">{layout}</p></div>;
  return <TooltipProvider><ReactFlowProvider><div className="w-full space-y-4"><div ref={root} className="relative flex h-96 items-center overflow-hidden rounded-xl border bg-card p-6">{slug !== "canvas-toolbar" && <FlowCanvasField root={root} themeKey="catalog" />}{slug !== "flow-canvas-field" && <div className="relative z-10"><CanvasToolbar tool={tool} onToolChange={setTool} pickerOpen={pickerOpen} onPickerOpenChange={setPickerOpen} picker={<div className="space-y-2 p-3 text-sm"><p>Add a sample step</p><Button variant="outline" size="sm" onClick={() => { setLayout("Knowledge step selected"); setPickerOpen(false); }}>Search knowledge</Button></div>} readOnly={false} onFit={() => setZoom(100)} onZoomIn={() => setZoom(Math.min(200, zoom + 10))} onZoomOut={() => setZoom(Math.max(20, zoom - 10))} controls={controls} /></div>}{slug === "editors" && <div className="relative mx-auto rounded-xl border bg-background px-5 py-4 text-sm"><p className="font-medium">Search knowledge</p><p className="mt-1 text-xs text-muted-foreground"><RollInText text={`${tool === "hand" ? "Pan" : "Select"} · ${zoom}%`} /></p></div>}</div><p aria-live="polite" className="text-xs text-muted-foreground">{layout}</p></div></ReactFlowProvider></TooltipProvider>;
}

function BrandPreview({ slug }: { slug: string }) {
  const [peekSelected, setPeekSelected] = useState(false);
  if (slug === "app-brand") return <div className="grid w-full gap-4 @xl:grid-cols-3">{APP_BRAND_ORDER.map((provider) => <div key={provider} className="flex items-center gap-3"><AppBrandMark provider={provider} /><span className="text-sm">{APP_BRANDS[provider].label}</span></div>)}</div>;
  if (slug === "provider-brand-icon") return <div className="flex flex-wrap gap-6">{(["anthropic", "openai", "google", "azure_openai", "elevenlabs"] satisfies Array<"anthropic" | "openai" | "google" | "azure_openai" | "elevenlabs">).map((provider) => <div key={provider} className="flex items-center gap-2"><ProviderBrandIcon provider={provider} /><Badge variant="secondary">{provider}</Badge></div>)}</div>;
  if (slug === "model-provider-logo") return <div className="flex flex-wrap gap-6">{(["anthropic", "openai", "google", "openai_compatible"] satisfies Array<"anthropic" | "openai" | "google" | "openai_compatible">).map((provider) => <div key={provider} className="flex items-center gap-2"><ModelProviderLogo provider={provider} /><span className="text-xs">{provider}</span></div>)}</div>;
  if (slug === "ghost-mark") return <GhostMark className="size-20" />;
  if (slug === "github-mark") return <GithubMark className="size-10" />;
  if (slug === "ciele-ai-peek") return <div className="space-y-4"><Button variant="outline" onClick={() => setPeekSelected(!peekSelected)} className="group relative overflow-hidden pr-16">New chat<CieleAiPeek className="absolute -bottom-3 right-2" /></Button><p aria-live="polite" className="text-xs text-muted-foreground">{peekSelected ? "Sample new chat selected." : "Hover or focus the button to see the peek."}</p></div>;
  return <div className="flex items-center gap-6"><CieleAiLogo className="size-12" /><CieleAiLogo className="size-16" /><span className="text-sm font-medium">Ciele AI</span></div>;
}

const SAMPLE_SPEECH = "data:audio/mpeg;base64,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";

function VoicePreview({ slug }: { slug: string }) {
  if (slug === "voice-input") return <div className="flex w-full max-w-xl items-center gap-3"><VoiceInputButton endpoint="" disabled onTranscript={() => {}} onBusyChange={() => {}} onStreamChange={() => {}} /><p className="text-sm text-muted-foreground">Voice input needs a configured transcription endpoint. The microphone stays disabled in this preview.</p></div>;
  return <div className="flex w-full max-w-xl items-center gap-3"><SpeechPlayback endpoint={SAMPLE_SPEECH} text="Sample response." /><div><p className="text-sm">Sample response.</p><p className="mt-1 text-xs text-muted-foreground">Play the bundled sample audio. This preview uses no synthesis service.</p></div></div>;
}

export default function PlatformPreview({ slug }: { slug: string }) {
  switch (slug) {
    case "charts": case "bar-chart": case "donut-chart": case "waffle-chart": case "streamgraph": case "bump-chart": case "slope-chart": case "ridgeline": case "treemap": case "brush-chart": case "activity-heatmap": case "sparkline": case "chart-container": case "arc-frame": return <ChartsPreview slug={slug} />;
    case "metric-cards": case "insights-stat-card": case "animated-counter": case "analytics-card": case "dashboard-stat-cards": return <MetricCardsPreview slug={slug} />;
    case "gauges": case "radial-gauge": return <GaugesPreview slug={slug} />;
    case "chat-messages": case "message-bubble": case "streaming-response": case "chat-markdown": case "message-scroller": case "chat-header": case "conversation": return <MessagesPreview slug={slug} />;
    case "reply-components": return <div className="w-full max-w-2xl"><ReplyPartsPreview /></div>;
    case "identity-gate": return <div className="w-full max-w-2xl"><IdentityPreview /></div>;
    case "voice-input": case "speech-playback": return <VoicePreview slug={slug} />;
    case "chat-composer": case "composer-pulse": case "command-bar": case "trigger-list": return <ComposerPreview slug={slug} />;
    case "model-source-select": case "model-allow-list": case "model-configuration": return <ModelChoicesPreview slug={slug} />;
    case "citations": case "transcript-citations": case "citation-list": case "citation-stack": case "inline-citation": return <CitationsPreview slug={slug} />;
    case "thinking": case "thinking-timeline": case "thinking-orb": case "thinking-shimmer": case "progress-line": case "agent-activity": return <ThinkingPreview slug={slug} />;
    case "tool-cards": case "tool-approval": case "agent-disclosure": return <ToolsPreview slug={slug} />;
    case "attachments": case "attachment-drop-hint": return <AttachmentsPreview slug={slug} />;
    case "reactions": case "reaction-record": case "emoji-picker": return <ReactionsPreview slug={slug} />;
    case "study-exercises": case "study-menu": return <StudyPreview slug={slug} />;
    case "task-progress": return <TasksPreview />;
    case "notifications": case "toasts": return <NotificationsPreview slug={slug} />;
    case "editors": case "canvas-toolbar": case "radial-menu": case "flow-canvas-field": case "markdown-editor": return <EditorsPreview slug={slug} />;
    case "file-tree": return <FileTreePreview />;
    case "navigation": case "nav-tree": case "find-row": case "intent-link": case "settings-sections": case "marketing-navigation": case "quick-search": return <NavigationPreview slug={slug} />;
    case "brand": case "ciele-ai-peek": case "app-brand": case "provider-brand-icon": case "model-provider-logo": case "github-mark": case "ghost-mark": return <BrandPreview slug={slug} />;
    default: throw new Error(`Unknown platform preview: ${slug}`);
  }
}
