"use client";

import { StatusBadge as StatusPill } from "@/components/spaceui/status-badge";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ChevronUp, MessageCircle, Plus, Search, X } from "lucide-react";
import { Button as CieleButton, cn } from "@agent-hub/ui";
import Link from "next/link";
import { formatDay } from "@/lib/format";
import { fuzzyFilter } from "@/lib/fuzzy";
import { canAutoFocus } from "@/lib/auto-focus";
import { RollingNumber } from "@/components/motion/rolling-number";
import { RollInText, RollRow } from "@/components/motion/roll-in-text";

/** One row of the picker: an assistant plus the two facts the list shows. */
export interface SetupPickerAssistant {
  id: string;
  title: string;
  nickname: string;
  avatarUrl?: string | null;
  /** Published (a Publication exists), the widget is live. */
  active: boolean;
  updatedAt: string;
}

const sweepSpring = {
  type: "spring" as const,
  stiffness: 400,
  damping: 35,
  mass: 0.5,
};

function StatusTag({ active }: { active: boolean }) {
  return <StatusPill status={active ? "online" : "offline"} primaryText={<RollInText text={active ? "Active" : "Inactive"} />} />;
}

function AssistantAvatar({
  assistant,
  className,
}: {
  assistant: SetupPickerAssistant;
  className?: string;
}) {
  if (assistant.avatarUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={assistant.avatarUrl}
        alt=""
        className={cn(
          "ring-background shrink-0 rounded-full object-cover ring-2",
          className
        )}
      />
    );
  }
  return (
    <span
      className={cn(
        "bg-primary/10 text-primary ring-background flex shrink-0 items-center justify-center rounded-full text-sm font-semibold uppercase ring-2",
        className
      )}
    >
      {assistant.title.charAt(0) || "A"}
    </span>
  );
}

function AssistantItem({
  assistant,
  href,
  reduce,
}: {
  assistant: SetupPickerAssistant;
  href: string;
  reduce: boolean;
}) {
  return (
    <motion.div
      variants={
        reduce
          ? { hidden: { opacity: 0 }, visible: { opacity: 1 } }
          : {
              hidden: { opacity: 0, x: 10, y: 15, rotate: 1 },
              visible: { opacity: 1, x: 0, y: 0, rotate: 0 },
            }
      }
      transition={reduce ? { duration: 0 } : sweepSpring}
      style={{ originX: 1, originY: 1 }}
      className="border-border/40 border-b py-4 first:pt-0 last:border-0"
    >
      <Link
        href={href}
        className="group press hover:bg-muted/40 focus-visible:ring-ring -mx-2 -my-1 flex items-center rounded-xl px-2 py-1 transition-colors outline-none focus-visible:ring-2"
      >
        <div className="relative mr-4 shrink-0">
          <AssistantAvatar assistant={assistant} className="size-12" />
        </div>
        <div className="min-w-0 flex-1">
          {/* A row title, not a section heading: the rows sit under the
              list's own h2/h3. */}
          <p className="text-foreground mb-1.5 truncate text-base leading-none font-semibold">
            <RollInText text={assistant.title} />
          </p>
          <p className="text-muted-foreground truncate text-sm leading-none">
            <RollInText
              text={
                assistant.nickname
                  ? `${assistant.nickname} · Updated ${formatDay(assistant.updatedAt)}`
                  : `Updated ${formatDay(assistant.updatedAt)}`
              }
            />
          </p>
        </div>
        <StatusTag active={assistant.active} />
      </Link>
    </motion.div>
  );
}

/**
 * "Choose an assistant to continue": the active assistants up front, the full
 * Assistants Directory behind an expanding bottom bar. Every row lands on the
 * requested SETUP section of that assistant.
 */
export function SetupPicker({
  slug,
  assistants,
}: {
  slug: string;
  assistants: SetupPickerAssistant[];
}) {
  const reduce = useReducedMotion() ?? false;
  const [isExpanded, setIsExpanded] = useState(false);
  const [query, setQuery] = useState("");
  const [directoryQuery, setDirectoryQuery] = useState("");
  /** Set by "…more": lights up the directory search until it is used. */
  const [highlightSearch, setHighlightSearch] = useState(false);
  const directorySearchRef = useRef<HTMLInputElement>(null);
  const directoryId = useId();
  /** "See all" remounts when the directory closes; focus goes back to it. */
  const seeAllRef = useRef<HTMLButtonElement>(null);
  const restoreFocus = useRef(false);

  const href = (id: string) => `/assistants/${id}/${slug}`;
  const searchText = (assistant: SetupPickerAssistant) =>
    `${assistant.title} ${assistant.nickname}`;

  const active = useMemo(
    () => assistants.filter((assistant) => assistant.active),
    [assistants]
  );
  const filteredActive = useMemo(
    () => fuzzyFilter(active, query, searchText),
    [active, query]
  );
  const filteredAll = useMemo(
    () => fuzzyFilter(assistants, directoryQuery, searchText),
    [assistants, directoryQuery]
  );

  const closeDirectory = () => {
    restoreFocus.current = true;
    setIsExpanded(false);
    setHighlightSearch(false);
  };

  useEffect(() => {
    if (isExpanded || !restoreFocus.current) return;
    restoreFocus.current = false;
    seeAllRef.current?.focus();
  }, [isExpanded]);

  const revealSearch = () => {
    setIsExpanded(true);
    setHighlightSearch(true);
  };

  // Focus follows the reveal, once the directory panel has actually mounted.
  useEffect(() => {
    if (!isExpanded || !highlightSearch) return;
    const frame = requestAnimationFrame(() =>
      directorySearchRef.current?.focus()
    );
    return () => cancelAnimationFrame(frame);
  }, [isExpanded, highlightSearch]);

  return (
    <div className="bg-background relative flex h-[560px] max-h-[75vh] w-full flex-col overflow-hidden rounded-[32px] border pb-6">
      <div className="px-6 pt-6 pb-3">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-foreground flex items-center gap-2 text-lg font-semibold tracking-tight">
            Active Assistants
            <span className="bg-muted text-muted-foreground mt-0.5 rounded-full px-2 py-1 text-xs leading-none font-normal">
              <RollingNumber value={active.length} />
            </span>
          </h2>
          <CieleButton variant="ghost" size="icon-sm" render={<Link href="/" />}

            aria-label="Create a new assistant"
            className="border-border/50 text-muted-foreground hover:bg-muted/50 flex size-9 items-center justify-center rounded-full border transition-colors"
          >
            <Plus aria-hidden className="size-4" />
          </CieleButton>
        </div>

        <div className="relative">
          <Search className="text-muted-foreground/60 absolute top-1/2 left-4 z-10 size-4 -translate-y-1/2" />
          <input
            autoFocus={canAutoFocus()}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Find Assistant…"
            aria-label="Find assistant"
            autoComplete="off"
            spellCheck={false}
            className="bg-muted/40 text-foreground placeholder:text-muted-foreground/50 focus-visible:ring-ring h-11 w-full rounded-2xl pr-4 pl-11 text-sm outline-none focus-visible:ring-2"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-6 pb-20">
        <motion.div
          initial={false}
          animate="visible"
          variants={{
            visible: {
              transition: reduce
                ? { duration: 0 }
                : { staggerChildren: 0.04 },
            },
          }}
        >
          {filteredActive.map((assistant, index) => (
            <RollRow key={`active-${assistant.id}`} index={index}>
              <AssistantItem assistant={assistant} href={href(assistant.id)} reduce={reduce} />
            </RollRow>
          ))}
        </motion.div>
        {filteredActive.length === 0 && (
          <p className="text-muted-foreground py-8 text-center text-sm break-words">
            {assistants.length === 0
              ? "No assistants yet, create one first."
              : active.length === 0
                ? "No published assistants, open the directory below."
                : `No active assistants match “${query}”.`}
          </p>
        )}
      </div>

      <motion.div
        layout={!reduce}
        initial={false}
        animate={{
          height: isExpanded ? "calc(100% - 20px)" : "68px",
          width: isExpanded ? "calc(100% - 20px)" : "calc(100% - 32px)",
          bottom: isExpanded ? "10px" : "16px",
          left: isExpanded ? "10px" : "16px",
          borderRadius: isExpanded ? "28px" : "20px",
        }}
        transition={
          reduce
            ? { duration: 0 }
            : { type: "spring", stiffness: 240, damping: 30, mass: 0.8 }
        }
        className="bg-card group/bar absolute z-50 flex flex-col overflow-hidden border"
        style={{ cursor: isExpanded ? "default" : "pointer" }}
        // A pointer shortcut only: the "See all" button is the keyboard path.
        onClick={() => !isExpanded && setIsExpanded(true)}
        onKeyDown={(event) => {
          if (isExpanded && event.key === "Escape") {
            event.stopPropagation();
            closeDirectory();
          }
        }}
      >
        <div
          className={cn(
            "flex h-[68px] shrink-0 items-center justify-between px-3 transition-colors",
            isExpanded ? "border-border/40 border-b" : "hover:bg-muted/20"
          )}
        >
          <div className="flex items-center gap-3">
            <span className="bg-background text-muted-foreground/80 group-hover/bar:scale-105 flex size-11 items-center justify-center rounded-xl border transition-transform motion-reduce:transform-none motion-reduce:transition-none">
              <MessageCircle className="size-5" />
            </span>
            <motion.div layout={reduce ? false : "position"}>
              <h3 className="text-foreground text-base leading-none font-medium">
                Assistants Directory
              </h3>
            </motion.div>
          </div>

          {isExpanded ? (
            <CieleButton variant="ghost" size="icon-sm"
              type="button"
              aria-label="Close the assistants directory"
              aria-expanded
              aria-controls={directoryId}
              className="bg-muted/60 text-muted-foreground hover:text-foreground flex size-9 items-center justify-center rounded-xl transition-[color,transform] active:scale-90 motion-reduce:transform-none motion-reduce:transition-none"
              onClick={(event) => {
                event.stopPropagation();
                closeDirectory();
              }}
            >
              <X aria-hidden className="size-4" />
            </CieleButton>
          ) : (
            <button
              type="button"
              ref={seeAllRef}
              aria-label={`Open the assistants directory, see all ${assistants.length}`}
              aria-expanded={false}
              aria-controls={directoryId}
              onClick={(event) => {
                event.stopPropagation();
                revealSearch();
              }}
              className="border-border/60 bg-background text-muted-foreground group-hover/bar:text-foreground group-hover/bar:border-border flex shrink-0 items-center gap-1.5 rounded-full border py-1.5 pr-2.5 pl-3 text-xs transition-colors"
            >
              See all {assistants.length}
              <ChevronUp className="size-3.5 transition-transform group-hover/bar:-translate-y-0.5 motion-reduce:transform-none motion-reduce:transition-none" />
            </button>
          )}
        </div>

        {/* Collapsed, the rows are still mounted under opacity 0: inert keeps
            their links out of the tab order until the directory opens. */}
        <div id={directoryId} inert={!isExpanded} className="flex flex-1 flex-col overflow-hidden">
          <AnimatePresence>
            {isExpanded && (
              <motion.div
                initial={reduce ? false : { opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={reduce ? { opacity: 0 } : { opacity: 0, y: -8 }}
                transition={reduce ? { duration: 0 } : undefined}
                className="px-5 py-4"
              >
                <div className="relative">
                  <Search className="text-muted-foreground/50 absolute top-1/2 left-3.5 z-10 size-4 -translate-y-1/2" />
                  <input
                    ref={directorySearchRef}
                    value={directoryQuery}
                    onChange={(event) => {
                      setDirectoryQuery(event.target.value);
                      setHighlightSearch(false);
                    }}
                    onBlur={() => setHighlightSearch(false)}
                    placeholder="Search assistants…"
                    aria-label="Search assistants"
                    autoComplete="off"
                    spellCheck={false}
                    className={cn(
                      "bg-muted/30 text-foreground placeholder:text-muted-foreground/40 h-10 w-full rounded-xl pr-4 pl-10 text-sm outline-none transition-shadow",
                      highlightSearch
                        ? "ring-primary/70 shadow-primary/20 ring-2 shadow-[0_0_0_4px]"
                        : "focus-visible:ring-border focus-visible:ring-1"
                    )}
                  />
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <div className="flex-1 overflow-y-auto px-5 py-2">
            <motion.div
              initial="hidden"
              animate={isExpanded ? "visible" : "hidden"}
              variants={{
                visible: {
                  transition: reduce
                    ? { duration: 0 }
                    : { staggerChildren: 0.03, delayChildren: 0.1 },
                },
                hidden: {
                  transition: reduce
                    ? { duration: 0 }
                    : { staggerChildren: 0.02, staggerDirection: -1 },
                },
              }}
            >
              {filteredAll.map((assistant, index) => (
                <RollRow key={`all-${assistant.id}`} index={index}>
                  <AssistantItem assistant={assistant} href={href(assistant.id)} reduce={reduce} />
                </RollRow>
              ))}
            </motion.div>
            {isExpanded && filteredAll.length === 0 && (
              <p className="text-muted-foreground py-8 text-center text-sm break-words">
                {assistants.length === 0
                  ? "No assistants yet, create one first."
                  : `No assistants match “${directoryQuery}”.`}
              </p>
            )}
          </div>
        </div>
      </motion.div>
    </div>
  );
}
