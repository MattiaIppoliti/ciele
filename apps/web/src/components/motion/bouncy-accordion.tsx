"use client";
// beui.dev/components/motion/bouncy-accordion

import {
  motion,
  useReducedMotion,
  type Transition,
} from "motion/react";
import { ChevronDown } from "lucide-react";
import {
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  EASE_OUT,
  SPRING_NUDGE,
  SPRING_REFOLD,
  SPRING_UNFOLD,
  SPRING_UNFOLD_FLAT,
} from "@/lib/ease";
import { cn } from "@/lib/utils";

export type BouncyAccordionItem = {
  id: string;
  title: ReactNode;
  description?: ReactNode;
};

export interface BouncyAccordionProps {
  items: BouncyAccordionItem[];
  className?: string;
}

// Shared springs keep the accordion's connected groups moving together while
// avoiding scale projection on text-heavy row contents. These were four local
// literals at bounce 0.38 / 0.32 / 0.28 / 0.26, differences too small to see
// and too many to defend as four decisions.
//
// The row spring is the flat one on purpose, and this is the constraint the old
// 0.38 contradicted while its own comment stated it: positive y overshoot
// drifts items past their mt-3 resting point and briefly overlaps the next.
const ROW_TRANSITION: Transition = SPRING_UNFOLD_FLAT;

const CONTENT_OPEN_TRANSITION: Transition = SPRING_UNFOLD;

const CONTENT_CLOSE_TRANSITION: Transition = SPRING_REFOLD;

const DESCRIPTION_TRANSITION: Transition = {
  duration: 0.18,
  ease: EASE_OUT,
};

const CHEVRON_TRANSITION: Transition = SPRING_NUDGE;

function BouncyAccordionRow({
  item,
  open,
  startsGroup,
  endsGroup,
  separatedFromPrevious,
  contentId,
  triggerId,
  reduce,
  onToggle,
}: {
  item: BouncyAccordionItem;
  open: boolean;
  startsGroup: boolean;
  endsGroup: boolean;
  separatedFromPrevious: boolean;
  contentId: string;
  triggerId: string;
  reduce: boolean | null;
  onToggle: () => void;
}) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [contentHeight, setContentHeight] = useState(0);

  useLayoutEffect(() => {
    const node = contentRef.current;
    if (!node) return;

    const updateHeight = () => {
      setContentHeight(node.offsetHeight);
    };

    updateHeight();

    const observer = new ResizeObserver(updateHeight);
    observer.observe(node);

    return () => {
      observer.disconnect();
    };
  }, []);

  return (
    <motion.div
      layout="position"
      initial={false}
      style={{ marginTop: separatedFromPrevious ? 12 : 0 }}
      transition={reduce ? { duration: 0 } : ROW_TRANSITION}
    >
      <motion.div
        data-state={open ? "open" : "closed"}
        initial={false}
        animate={{
          borderTopLeftRadius: startsGroup ? 28 : 0,
          borderTopRightRadius: startsGroup ? 28 : 0,
          borderBottomLeftRadius: endsGroup ? 28 : 0,
          borderBottomRightRadius: endsGroup ? 28 : 0,
        }}
        transition={reduce ? { duration: 0 } : ROW_TRANSITION}
        className={cn(
          "overflow-hidden bg-card text-card-foreground",
          // Match the translucent surfaces the marketing pages sit on, so the
          // rows read as part of the sky shell rather than as opaque cards.
          "bg-card/60 ring-1 ring-border/60 backdrop-blur-sm",
        )}
      >
        <button
          id={triggerId}
          type="button"
          aria-expanded={open}
          aria-controls={contentId}
          onClick={onToggle}
          className={cn(
            "flex min-h-[54px] w-full items-center gap-4 px-5 text-left outline-none transition-colors",
            "focus-visible:bg-muted/25",
            "disabled:pointer-events-none",
          )}
        >
          <span
            className={cn(
              "min-w-0 flex-1 truncate text-[0.9375rem] font-medium text-foreground",
              "whitespace-normal text-wrap",
            )}
          >
            {item.title}
          </span>
          <motion.span
            aria-hidden
            animate={{ rotate: open ? 180 : 0 }}
            transition={reduce ? { duration: 0 } : CHEVRON_TRANSITION}
            className="grid h-6 w-6 shrink-0 place-items-center text-muted-foreground"
          >
            <ChevronDown className="h-4 w-4" />
          </motion.span>
        </button>

        <motion.div
          layout="size"
          id={contentId}
          role="region"
          aria-labelledby={triggerId}
          aria-hidden={!open}
          initial={false}
          style={{ height: open && item.description ? contentHeight : 0 }}
          transition={
            reduce
              ? { duration: 0 }
              : open
                ? CONTENT_OPEN_TRANSITION
                : CONTENT_CLOSE_TRANSITION
          }
          className="overflow-hidden"
        >
          <motion.div
            ref={contentRef}
            animate={{
              opacity: open ? 1 : 0,
            }}
            transition={reduce ? { duration: 0 } : DESCRIPTION_TRANSITION}
            className="px-5 pb-5"
          >
            <div className="text-[0.9375rem] leading-6 text-muted-foreground">
              {item.description}
            </div>
          </motion.div>
        </motion.div>
      </motion.div>
    </motion.div>
  );
}

export function BouncyAccordion({ items, className }: BouncyAccordionProps) {
  const reduce = useReducedMotion();
  const baseId = useId();
  const [activeValue, setActiveValue] = useState<string | null>(null);
  const activeIndex = items.findIndex((item) => item.id === activeValue);

  return (
    <div className={cn("w-full", className)}>
      {items.map((item, index) => {
        const open = activeValue === item.id;
        const previousIsOpen = activeIndex === index - 1;
        const nextIsOpen = activeIndex === index + 1;
        const startsGroup = open || index === 0 || previousIsOpen;
        const endsGroup = open || index === items.length - 1 || nextIsOpen;
        const separatedFromPrevious = index > 0 && (open || previousIsOpen);
        const contentId = `${baseId}-${item.id}-content`;
        const triggerId = `${baseId}-${item.id}-trigger`;

        return (
          <BouncyAccordionRow
            key={item.id}
            item={item}
            open={open}
            startsGroup={startsGroup}
            endsGroup={endsGroup}
            separatedFromPrevious={separatedFromPrevious}
            contentId={contentId}
            triggerId={triggerId}
            reduce={reduce}
            onToggle={() => setActiveValue(open ? null : item.id)}
          />
        );
      })}
    </div>
  );
}
