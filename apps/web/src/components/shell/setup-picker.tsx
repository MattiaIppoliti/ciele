"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ChevronUp, MessageCircle, Plus, Search, X } from "lucide-react";
import { cn } from "@agent-hub/ui";
import { Link } from "@/components/ui/link";
import { formatDay } from "@/lib/format";
import { fuzzyFilter } from "@/lib/fuzzy";

/** One row of the picker: an assistant plus the two facts the list shows. */
export interface SetupPickerAssistant {
  id: string;
  title: string;
  nickname: string;
  avatarUrl?: string | null;
  /** Published (a Publication exists) — the widget is live. */
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
  return (
    <span
      className={cn(
        "shrink-0 rounded-full border px-2.5 py-1 text-xs font-normal tracking-tight uppercase",
        active
          ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-400"
          : "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-400"
      )}
    >
      {active ? "Active" : "Inactive"}
    </span>
  );
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
}: {
  assistant: SetupPickerAssistant;
  href: string;
}) {
  return (
    <motion.div
      variants={{
        hidden: { opacity: 0, x: 10, y: 15, rotate: 1 },
        visible: { opacity: 1, x: 0, y: 0, rotate: 0 },
      }}
      transition={sweepSpring}
      style={{ originX: 1, originY: 1 }}
      className="border-border/40 border-b py-4 first:pt-0 last:border-0"
    >
      <Link href={href} className="group flex items-center">
        <div className="relative mr-4 shrink-0">
          <AssistantAvatar assistant={assistant} className="size-12" />
          {assistant.active && (
            <span className="bg-background absolute right-0 bottom-0 flex size-3.5 items-center justify-center rounded-full shadow-sm">
              <span className="size-2 rounded-full bg-emerald-500" />
            </span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-foreground mb-1.5 truncate text-base leading-none font-semibold tracking-tight">
            {assistant.title}
          </h3>
          <p className="text-muted-foreground truncate text-sm leading-none">
            {assistant.nickname
              ? `${assistant.nickname} · Updated ${formatDay(assistant.updatedAt)}`
              : `Updated ${formatDay(assistant.updatedAt)}`}
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
  const [isExpanded, setIsExpanded] = useState(false);
  const [query, setQuery] = useState("");
  const [directoryQuery, setDirectoryQuery] = useState("");
  /** Set by "…more": lights up the directory search until it is used. */
  const [highlightSearch, setHighlightSearch] = useState(false);
  const directorySearchRef = useRef<HTMLInputElement>(null);

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
              {active.length}
            </span>
          </h2>
          <Link
            href="/"
            aria-label="Create a new assistant"
            className="border-border/50 text-muted-foreground hover:bg-muted/50 flex size-9 items-center justify-center rounded-full border transition-colors"
          >
            <Plus className="size-4" />
          </Link>
        </div>

        <div className="relative">
          <Search className="text-muted-foreground/60 absolute top-1/2 left-4 z-10 size-4 -translate-y-1/2" />
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Find Assistant..."
            className="bg-muted/40 text-foreground placeholder:text-muted-foreground/50 focus-visible:ring-border h-11 w-full rounded-2xl pr-4 pl-11 text-sm outline-none focus-visible:ring-1"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-6 pb-20">
        <motion.div
          initial={false}
          animate="visible"
          variants={{ visible: { transition: { staggerChildren: 0.04 } } }}
        >
          {filteredActive.map((assistant) => (
            <AssistantItem
              key={`active-${assistant.id}`}
              assistant={assistant}
              href={href(assistant.id)}
            />
          ))}
        </motion.div>
        {filteredActive.length === 0 && (
          <p className="text-muted-foreground py-8 text-center text-sm">
            {assistants.length === 0
              ? "No assistants yet — create one first."
              : active.length === 0
                ? "No published assistants — open the directory below."
                : `No active assistants match “${query}”.`}
          </p>
        )}
      </div>

      <motion.div
        layout
        initial={false}
        animate={{
          height: isExpanded ? "calc(100% - 20px)" : "68px",
          width: isExpanded ? "calc(100% - 20px)" : "calc(100% - 32px)",
          bottom: isExpanded ? "10px" : "16px",
          left: isExpanded ? "10px" : "16px",
          borderRadius: isExpanded ? "28px" : "20px",
        }}
        transition={{ type: "spring", stiffness: 240, damping: 30, mass: 0.8 }}
        className="bg-card group/bar absolute z-50 flex flex-col overflow-hidden border"
        style={{ cursor: isExpanded ? "default" : "pointer" }}
        onClick={() => !isExpanded && setIsExpanded(true)}
      >
        <div
          className={cn(
            "flex h-[68px] shrink-0 items-center justify-between px-3 transition-colors",
            isExpanded ? "border-border/40 border-b" : "hover:bg-muted/20"
          )}
        >
          <div className="flex items-center gap-3">
            <span className="bg-background text-muted-foreground/80 group-hover/bar:scale-105 flex size-11 items-center justify-center rounded-xl border transition-transform">
              <MessageCircle className="size-5" />
            </span>
            <motion.div layout="position">
              <h4 className="text-foreground text-base leading-none font-medium tracking-tight">
                Assistants Directory
              </h4>
            </motion.div>
          </div>

          {isExpanded ? (
            <button
              type="button"
              aria-label="Close the assistants directory"
              className="bg-muted/60 text-muted-foreground hover:text-foreground flex size-9 items-center justify-center rounded-xl transition-all active:scale-90"
              onClick={(event) => {
                event.stopPropagation();
                setIsExpanded(false);
                setHighlightSearch(false);
              }}
            >
              <X className="size-4" />
            </button>
          ) : (
            <button
              type="button"
              aria-label={`Open the assistants directory — see all ${assistants.length}`}
              onClick={(event) => {
                event.stopPropagation();
                revealSearch();
              }}
              className="border-border/60 bg-background text-muted-foreground group-hover/bar:text-foreground group-hover/bar:border-border flex shrink-0 items-center gap-1.5 rounded-full border py-1.5 pr-2.5 pl-3 text-xs transition-colors"
            >
              See all {assistants.length}
              <ChevronUp className="size-3.5 transition-transform group-hover/bar:-translate-y-0.5" />
            </button>
          )}
        </div>

        <div className="flex flex-1 flex-col overflow-hidden">
          <AnimatePresence>
            {isExpanded && (
              <motion.div
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
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
                    placeholder="Search assistants..."
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
                  transition: { staggerChildren: 0.03, delayChildren: 0.1 },
                },
                hidden: {
                  transition: { staggerChildren: 0.02, staggerDirection: -1 },
                },
              }}
            >
              {filteredAll.map((assistant) => (
                <AssistantItem
                  key={`all-${assistant.id}`}
                  assistant={assistant}
                  href={href(assistant.id)}
                />
              ))}
            </motion.div>
            {isExpanded && filteredAll.length === 0 && (
              <p className="text-muted-foreground py-8 text-center text-sm">
                {assistants.length === 0
                  ? "No assistants yet — create one first."
                  : `No assistants match “${directoryQuery}”.`}
              </p>
            )}
          </div>
        </div>
      </motion.div>
    </div>
  );
}
