"use client";

import { FileText, X } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { useContext } from "react";
import { Visual1 } from "@/components/core/visual-1";
import { AmbientActiveContext } from "@/components/home/use-in-viewport";
import { EASE_OUT } from "@/lib/ease";

/** Compact "document indexing" row, a file with a looping upload bar. Appears
 * on card hover in place of Visual1's default caption. */
function UploadingFileRow() {
  const reduce = useReducedMotion();
  // Pause the looping upload bar when the Features section is off screen
  // (null = no provider, e.g. inside the opened dialog → treat as active).
  const active = useContext(AmbientActiveContext) ?? true;
  const animating = active && !reduce;

  return (
    <div className="border-border bg-background/85 w-[188px] rounded-md border p-1.5 shadow-sm backdrop-blur-sm">
      <div className="flex items-center gap-2">
        <div className="bg-muted text-muted-foreground grid h-6 w-6 shrink-0 place-items-center rounded-md">
          <FileText className="h-3 w-3" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-1.5">
            <div className="min-w-0">
              <p className="text-foreground truncate text-[10px] font-medium leading-tight">
                Acme Customer Info.pdf
              </p>
              <p className="text-muted-foreground text-[9px] leading-tight">
                PDF · 274 KB
              </p>
            </div>
            <span className="text-muted-foreground grid h-4 w-4 shrink-0 place-items-center">
              <X className="h-2.5 w-2.5" />
            </span>
          </div>
          <div className="bg-muted mt-1.5 h-1 overflow-hidden rounded-full">
            <motion.div
              className="bg-foreground h-full rounded-full"
              style={{ transformOrigin: "left" }}
              initial={{ scaleX: animating ? 0.06 : 0.66 }}
              animate={animating ? { scaleX: [0.06, 1] } : { scaleX: 0.66 }}
              transition={
                animating
                  ? {
                      duration: 2.4,
                      ease: EASE_OUT,
                      repeat: Infinity,
                      repeatType: "loop",
                      repeatDelay: 0.35,
                    }
                  : undefined
              }
            />
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Knowledge card visual: the badtz-ui "Visual 1" rising bar/line chart in
 * neutral grey (accuracy climbing as company knowledge is connected). On card
 * hover the document-indexing row slides in from the top.
 */
export function KnowledgeVisual() {
  return (
    <div className="group/animated-card bg-card relative flex h-[180px] items-center justify-center overflow-hidden">
      <Visual1
        mainColor="#71717a"
        secondaryColor="#a1a1aa"
        gridColor="#8080801f"
        label={<UploadingFileRow />}
      />
    </div>
  );
}
