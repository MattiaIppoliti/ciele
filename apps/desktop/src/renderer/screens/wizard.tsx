// The guided local setup.
//
// The engine decides everything; this draws it. Which step is showing, whether
// Continue is available, what a failure says — all of it is read off the
// snapshot, so the screen cannot disagree with what actually ran.

import {
  AlertTriangle,
  ArrowRight,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Loader2,
} from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { bridge, navigate } from "../lib/bridge";
import { setupBridge } from "../lib/setup-bridge";
import { Button, Field, Input } from "../components/ui";
import { WizardShell } from "../components/wizard-shell";
import type { SetupSnapshot } from "../../shared/setup-ipc";
import type { StepView } from "../../setup/types";

function StatusIcon({ status }: { status: StepView["status"] }): ReactNode {
  if (status === "running") return <Loader2 className="size-4 animate-spin text-accent" />;
  if (status === "done") return <Check className="size-4 text-accent" />;
  if (status === "failed") return <AlertTriangle className="size-4 text-danger" />;
  return null;
}

function Logs({ lines }: { lines: string[] }): ReactNode {
  const [open, setOpen] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (open) end.current?.scrollIntoView({ block: "nearest" });
  }, [open, lines.length]);

  if (lines.length === 0) return null;
  return (
    <div className="rounded-lg border border-line bg-canvas">
      <button
        type="button"
        className="flex w-full items-center gap-2 px-3 py-2 text-xs text-ink-muted hover:text-ink"
        onClick={() => setOpen((was) => !was)}
        aria-expanded={open}
      >
        <ChevronDown className={`size-3.5 transition ${open ? "" : "-rotate-90"}`} />
        {open ? "Hide" : "Show"} details ({lines.length})
      </button>
      {open ? (
        <pre
          className="max-h-48 overflow-auto px-3 pb-3 font-mono text-[11px] leading-relaxed text-ink-muted"
          data-testid="step-logs"
        >
          {lines.join("\n")}
          <div ref={end} />
        </pre>
      ) : null}
    </div>
  );
}

function StepBody({
  step,
  values,
  onChange,
}: {
  step: StepView;
  values: Record<string, string>;
  onChange: (id: string, value: string) => void;
}): ReactNode {
  return (
    <div className="flex flex-col gap-4 py-4" data-testid={`step-${step.id}`}>
      {/* What this step is saying *now*. The shell's header already carries the
          description, so repeating it here when there is nothing to report
          would be the same sentence twice. */}
      {step.error ?? step.detail ? (
        <div className="flex items-start gap-2">
          <div className="pt-0.5">
            <StatusIcon status={step.status} />
          </div>
          <p
            className={step.status === "failed" ? "text-sm text-danger" : "text-sm text-ink-muted"}
            data-testid="step-message"
          >
            {step.error ?? step.detail}
          </p>
        </div>
      ) : null}

      {/* The walkthrough for this exact failure: numbered, plain language,
          nothing the user cannot see on their own screen. */}
      {step.guide.length > 0 ? (
        <ol className="flex flex-col gap-2" data-testid="step-guide">
          {step.guide.map((instruction, index) => (
            <li key={instruction} className="flex items-start gap-3 text-sm text-ink-muted">
              <span className="flex size-5 shrink-0 items-center justify-center rounded-full border border-line font-mono text-[11px] leading-none text-ink">
                {index + 1}
              </span>
              {instruction}
            </li>
          ))}
        </ol>
      ) : null}

      {step.fields.length > 0 && step.status !== "done" ? (
        <div className="flex flex-col gap-3">
          {step.fields.map((field) => (
            <Field key={field.id} label={field.label} hint={field.hint}>
              <Input
                type={field.secret ? "password" : "text"}
                placeholder={field.placeholder}
                value={values[field.id] ?? ""}
                spellCheck={false}
                autoCapitalize="off"
                data-testid={`field-${field.id}`}
                onChange={(event) => onChange(field.id, event.target.value)}
              />
            </Field>
          ))}
        </div>
      ) : null}

      <Logs lines={step.logs} />
    </div>
  );
}

export function WizardScreen(): ReactNode {
  const [snapshot, setSnapshot] = useState<SetupSnapshot | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  /**
   * Which step the user is *looking at*, when that is not the one the engine
   * is on. Null means "follow along", which is the normal case.
   *
   * Looking and running are separate on purpose: the engine's position is
   * derived from what has actually happened, so the renderer cannot move it by
   * asking. Going back is therefore browsing — and where it can be more than
   * browsing (an optional step), the button that does it says so.
   */
  const [viewIndex, setViewIndex] = useState<number | null>(null);
  const previousView = useRef(0);

  useEffect(() => {
    void setupBridge().getSnapshot().then(setSnapshot);
    return setupBridge().onSnapshot(setSnapshot);
  }, []);

  // Kick the required chain off as soon as the screen is up. There is nothing
  // to decide before the Docker check, and making the user press Start to
  // begin a check they cannot influence is ceremony.
  useEffect(() => {
    if (snapshot && !snapshot.running && snapshot.currentIndex === 0) {
      const first = snapshot.steps[0];
      if (first?.status === "pending") void setupBridge().run();
    }
  }, [snapshot]);

  if (!snapshot) return <div className="h-full" />;

  const viewing = Math.min(viewIndex ?? snapshot.currentIndex, snapshot.steps.length - 1);
  const step = snapshot.steps[viewing]!;
  const isLive = viewing === snapshot.currentIndex;

  const direction = viewing >= previousView.current ? 1 : -1;
  previousView.current = viewing;

  /** Any action puts the user back on the live step — that is where it lands. */
  const act = async (action: () => Promise<unknown>) => {
    setViewIndex(null);
    await action();
  };

  const submit = () =>
    act(async () => {
      if (step.fields.length > 0) await setupBridge().setInput(step.id, values);
      await setupBridge().run();
    });

  return (
    <div className="flex h-full items-center justify-center">
      <WizardShell
        title={step.title}
        description={step.description}
        stepCount={snapshot.steps.length}
        currentStep={viewing}
        direction={direction}
        footer={
          <>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                disabled={viewing === 0}
                onClick={() => setViewIndex(viewing - 1)}
                data-testid="back"
              >
                <ChevronLeft className="size-4" />
                Back
              </Button>
              {/* The one thing this failure asks the user to go and do, in
                  the footer rather than in the body: the body scrolls out of
                  a short window, and the remedy must never be the part that
                  is off screen. */}
              {step.help ? (
                <Button
                  variant="secondary"
                  onClick={() => void bridge().openExternal(step.help!.url)}
                  data-testid="step-help"
                >
                  <ExternalLink className="size-4" />
                  {step.help.label}
                </Button>
              ) : null}
              {isLive && step.optional && !snapshot.running && !snapshot.complete ? (
                <Button variant="ghost" onClick={() => void act(() => setupBridge().skip())}>
                  Skip
                </Button>
              ) : null}
              {isLive && snapshot.complete ? (
                <Button
                  variant="ghost"
                  onClick={() => navigate("/stack")}
                  data-testid="stack-status"
                >
                  Stack status
                </Button>
              ) : null}
            </div>
            <div className="flex items-center gap-2">
              {!isLive ? (
                <>
                  {/* A required step's result is what everything after it
                      stands on, so only an optional one can be reopened — and
                      the label promises exactly that much. */}
                  {step.optional ? (
                    <Button
                      variant="secondary"
                      onClick={() => void act(() => setupBridge().revisit(step.id))}
                      data-testid="revisit"
                    >
                      {step.status === "skipped" ? "Do this step" : "Change this"}
                    </Button>
                  ) : null}
                  <Button
                    onClick={() =>
                      setViewIndex(viewing + 1 >= snapshot.currentIndex ? null : viewing + 1)
                    }
                    data-testid="forward"
                  >
                    Forward <ChevronRight className="size-4" />
                  </Button>
                </>
              ) : snapshot.complete ? (
                <Button onClick={() => void bridge().openProduct()} data-testid="open-ciele">
                  Open Ciele <ArrowRight className="size-4" />
                </Button>
              ) : step.status === "failed" ? (
                <Button
                  onClick={() => void act(() => setupBridge().retry())}
                  data-testid="retry"
                >
                  Try again
                </Button>
              ) : snapshot.awaitingDecision ? (
                <Button onClick={() => void submit()} data-testid="continue">
                  Continue <ArrowRight className="size-4" />
                </Button>
              ) : (
                <Button disabled data-testid="working">
                  <Loader2 className="size-4 animate-spin" />
                  Working…
                </Button>
              )}
            </div>
          </>
        }
      >
        <StepBody
          step={step}
          values={values}
          onChange={(id, value) => setValues((was) => ({ ...was, [id]: value }))}
        />
      </WizardShell>
    </div>
  );
}
