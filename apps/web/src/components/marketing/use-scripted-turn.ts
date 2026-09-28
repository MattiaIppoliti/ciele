"use client";

import { useEffect, useState } from "react";
import type { TurnPhase, TurnStep } from "@agent-hub/agent/client";

/** The setters a scripted demo turn drives. */
export interface ScriptApi {
  setSteps: (update: (steps: TurnStep[]) => TurnStep[]) => void;
  setPhase: (phase: TurnPhase) => void;
  setProgress: (lines: string[]) => void;
  setStreaming: (text: string | null) => void;
  setAnswered: (answered: boolean) => void;
}

/** The scripted step sequence, (delayMs, apply) pairs run in order. */
export type BuildScript = (api: ScriptApi) => Array<[number, () => void]>;

/* One dial over the whole script's tempo. The delays in a script are written
   as the turn's *shape*, which beat is longer than which, and this stretches
   them: played at their raw speed the turn reasoned and answered faster than a
   reader can follow the panel, so the thinking never registered. */
const PACE = 1.5;

/** The frame every loop ends on, also the still shown before the loop has
 *  ever run (reduced motion, or the observer's first tick). */
export function finalSteps(buildScript: BuildScript): TurnStep[] {
  const steps: TurnStep[] = [];
  const script = buildScript({
    setSteps: (update) => {
      const next = update(steps);
      steps.length = 0;
      steps.push(...next);
    },
    setPhase: () => {},
    setProgress: () => {},
    setStreaming: () => {},
    setAnswered: () => {},
  });
  for (const [, apply] of script) apply();
  return steps;
}

/**
 * Plays `buildScript` on a loop while `active`, holding the finished answer
 * for `dwellMs` before each replay. Starts on the finished conversation; the
 * first activation resets and plays. Under reduced motion `active` never
 * flips, so the still is all there is.
 */
export function useScriptedTurn(
  active: boolean,
  buildScript: BuildScript,
  final: TurnStep[],
  dwellMs: number,
) {
  const [steps, setSteps] = useState<TurnStep[]>(final);
  const [phase, setPhase] = useState<TurnPhase>("done");
  const [progress, setProgress] = useState<string[]>([]);
  const [streaming, setStreaming] = useState<string | null>(null);
  const [answered, setAnswered] = useState(true);
  // Remounts the scripted turn per replay, so the panel's elapsed clock and
  // entrance animations start fresh each run.
  const [runId, setRunId] = useState(0);

  useEffect(() => {
    if (!active) return;
    const timers: number[] = [];
    // Deferred a tick so the effect body itself never calls setState.
    timers.push(
      window.setTimeout(() => {
        setSteps([]);
        setPhase("running");
        setProgress([]);
        setStreaming(null);
        setAnswered(false);
      }, 0)
    );

    let at = 0;
    for (const [delay, apply] of buildScript({
      setSteps,
      setPhase,
      setProgress,
      setStreaming,
      setAnswered,
    })) {
      at += delay * PACE;
      timers.push(window.setTimeout(apply, at));
    }
    // The loop: hold the finished answer, then replay from the top.
    timers.push(
      window.setTimeout(() => setRunId((run) => run + 1), at + dwellMs)
    );
    return () => {
      for (const timer of timers) window.clearTimeout(timer);
    };
  }, [active, runId, buildScript, dwellMs]);

  return { steps, phase, progress, streaming, answered, runId };
}
