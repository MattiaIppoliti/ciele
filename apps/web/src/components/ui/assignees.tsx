"use client";

import { useMemo, useState, useTransition } from "react";
import { motion, useReducedMotion } from "motion/react";
import { Plus, Search, UserRoundPlus } from "lucide-react";
import {
  Button,
  Hint,
  Input,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@agent-hub/ui";
import { GeneratedAvatar } from "@/components/ui/generated-avatar";
import {
  ASSIGNEE_DEFAULTS,
  assigneeStackGeometry,
  type AssigneeStack,
} from "@/lib/assignee-stack";
import { cn } from "@/lib/utils";

/**
 * Assignees: the faces of a room, and the one control that adds to it.
 *
 * The block (bencho.dev, MIT) is a stack of faces beside an Add button. What it
 * is here is the header of a Teammate group, where the strip of avatars was
 * decoration and the Add button opened a modal over the transcript. Putting the
 * two in one block changes both:
 *
 *  - **The faces are a trigger too.** Who is here and how you change it are the
 *    same question, so the stack opens the same picker the button does. The
 *    button stays: a row of avatars does not read as pressable, and a group with
 *    nobody in it yet has no faces to click.
 *  - **A popover, not a dialog.** Adding somebody to a group you are reading is
 *    an aside. Two short lists do not earn a modal that covers the thread.
 *
 * The three geometry props are the block's own (`corner`, `stack`, `overlap`),
 * kept at its API so a value from its panel means the same thing here.
 * `src/lib/assignee-stack.ts` resolves them, and is where the clamps are tested:
 * this app's suite is `.test.ts` in node, so a component is the one thing it
 * cannot assert.
 */

export interface Assignee {
  id: string;
  name: string;
  /** Resolved by the caller: a Teammate's seed is not a person's user id. */
  seed: string;
  /** A second line in the picker, e.g. a Teammate's title. */
  note?: string;
}

/**
 * One section of the picker. Each section carries its own action rather than
 * the block dispatching on a label: adding a Teammate and inviting a person are
 * two different operations, and the block has no business telling them apart.
 */
export interface AssigneeGroup {
  label: string;
  items: Assignee[];
  /** What the section says when it has nobody left to offer. */
  empty: string;
  onPick: (item: Assignee) => Promise<void>;
  /** The row's verb. "Add" unless the caller says otherwise. */
  actionLabel?: string;
}

export interface AssigneesProps {
  /** Everybody already in the room, in the order they should be drawn. */
  assigned: Assignee[];
  groups: AssigneeGroup[];
  /** Face corner radius, 0 to 26px. Capped at a circle. */
  corner?: number;
  /** A growing row, or four packed into the width of one. */
  stack?: AssigneeStack;
  /** How far the faces stack over each other, 0 to 22px. */
  overlap?: number;
  /** Faces drawn before the rest become a `+N`. Row only. */
  max?: number;
  addLabel?: string;
  /** Names the stack for a screen reader, e.g. "Who is in the group". */
  label?: string;
  className?: string;
}

/** Which of the two triggers owns the open popover. */
type OpenFrom = "stack" | "add" | null;

export function Assignees({
  assigned,
  groups,
  corner = ASSIGNEE_DEFAULTS.corner,
  stack = ASSIGNEE_DEFAULTS.stack,
  overlap = ASSIGNEE_DEFAULTS.overlap,
  max = ASSIGNEE_DEFAULTS.max,
  addLabel = "Add",
  label = "Who is here",
  className,
}: AssigneesProps) {
  const [openFrom, setOpenFrom] = useState<OpenFrom>(null);
  const geometry = assigneeStackGeometry({
    count: assigned.length,
    corner,
    stack,
    overlap,
    max,
  });
  const shown = assigned.slice(0, geometry.shown);
  const grid = stack === "Grid";

  return (
    <div className={cn("flex items-center gap-2", className)}>
      {assigned.length > 0 && (
        <Picker
          open={openFrom === "stack"}
          onOpenChange={(next) => setOpenFrom(next ? "stack" : null)}
          groups={groups}
          trigger={
            <button
              type="button"
              aria-label={label}
              className={cn(
                "ring-ring/50 flex shrink-0 cursor-pointer rounded-lg outline-none focus-visible:ring-3",
                grid ? "flex-wrap content-start gap-[2px]" : "items-center"
              )}
              style={
                grid
                  ? { width: geometry.boxSize, height: geometry.boxSize }
                  : undefined
              }
            />
          }
        >
          {shown.map((face, index) => (
            <Face
              key={face.id}
              assignee={face}
              geometry={geometry}
              first={index === 0}
            />
          ))}
          {geometry.rest > 0 && (
            <span
              // `relative` earns the badge a paint order. A face is a motion
              // span, so its transform makes it a stacking context, and a plain
              // in-flow sibling paints under every one of them: the `+N` came
              // out buried beneath the face it overlaps.
              className="bg-alpha-light text-muted-foreground ring-background relative flex items-center justify-center font-semibold ring-2"
              style={{
                width: geometry.faceSize,
                height: geometry.faceSize,
                borderRadius: geometry.radius,
                marginLeft: grid || shown.length === 0 ? 0 : -geometry.offset,
                fontSize: grid ? 9 : 11,
              }}
            >
              +{geometry.rest}
            </span>
          )}
        </Picker>
      )}

      <Picker
        open={openFrom === "add"}
        onOpenChange={(next) => setOpenFrom(next ? "add" : null)}
        groups={groups}
        trigger={<Button variant="outline" size="sm" />}
      >
        <UserRoundPlus className="size-4" /> {addLabel}
      </Picker>
    </div>
  );
}

function Face({
  assignee,
  geometry,
  first,
}: {
  assignee: Assignee;
  geometry: ReturnType<typeof assigneeStackGeometry>;
  first: boolean;
}) {
  const still = useReducedMotion();
  return (
    <Hint label={assignee.name}>
      <motion.span
        // A face appearing is the whole confirmation that the add landed: the
        // popover closes over the stack it just changed. It scales from the
        // centre rather than sliding in, because a slide would shove the faces
        // beside it. Only a new face animates: React keeps the others mounted
        // across the refresh, so `initial` never runs on them again.
        initial={still ? false : { scale: 0.6, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: "spring", stiffness: 520, damping: 34 }}
        className="ring-background bg-muted block overflow-hidden ring-2"
        style={{
          width: geometry.faceSize,
          height: geometry.faceSize,
          borderRadius: geometry.radius,
          marginLeft: first ? 0 : -geometry.offset,
        }}
      >
        <GeneratedAvatar
          seed={assignee.seed}
          size="size-full"
          // The wrapper owns the shape. The avatar's own `rounded-full` would
          // clip a square corner straight back into a circle.
          className="rounded-[inherit]"
        />
      </motion.span>
    </Hint>
  );
}

function Picker({
  open,
  onOpenChange,
  groups,
  trigger,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  groups: AssigneeGroup[];
  /** The bare element base-ui renders the trigger as; its content is `children`. */
  trigger: React.ReactElement;
  children: React.ReactNode;
}) {
  const [query, setQuery] = useState("");
  const [picking, setPicking] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const sections = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return groups;
    return groups
      .map((group) => ({
        ...group,
        items: group.items.filter(
          (item) =>
            item.name.toLowerCase().includes(needle) ||
            (item.note ?? "").toLowerCase().includes(needle)
        ),
      }))
      // A search that matches nothing in a section hides the section, rather
      // than showing its "everybody is already here" line, which would be a lie
      // about the search.
      .filter((group) => group.items.length > 0);
  }, [groups, query]);

  function pick(group: AssigneeGroup, item: Assignee) {
    setPicking(item.id);
    startTransition(async () => {
      try {
        await group.onPick(item);
        onOpenChange(false);
        setQuery("");
      } finally {
        // The caller reports its own failure. The row only has to stop
        // pretending it is still working.
        setPicking(null);
      }
    });
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) setQuery("");
      }}
    >
      <PopoverTrigger render={trigger}>{children}</PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="relative border-b p-2">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-4 size-3.5 -translate-y-1/2" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search"
            aria-label="Search who to add"
            className="h-8 pl-8"
          />
        </div>
        <div className="max-h-72 overflow-y-auto p-1">
          {sections.length === 0 && (
            <p className="text-muted-foreground px-2 py-6 text-center text-sm">
              Nobody matches that.
            </p>
          )}
          {sections.map((group) => (
            <section key={group.label} className="py-1">
              <p className="text-muted-foreground px-2 pb-1 text-xs font-medium">
                {group.label}
              </p>
              {group.items.length === 0 ? (
                <p className="text-muted-foreground px-2 pb-1 text-sm">
                  {group.empty}
                </p>
              ) : (
                <ul>
                  {group.items.map((item) => (
                    <li key={item.id}>
                      <button
                        type="button"
                        disabled={isPending}
                        onClick={() => pick(group, item)}
                        className="hover:bg-alpha-light flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors disabled:opacity-50"
                      >
                        <GeneratedAvatar seed={item.seed} size="size-7" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">
                            {item.name}
                          </span>
                          {item.note && (
                            <span className="text-muted-foreground block truncate text-xs">
                              {item.note}
                            </span>
                          )}
                        </span>
                        <span className="text-muted-foreground flex shrink-0 items-center gap-1 text-xs">
                          <Plus className="size-3.5" />
                          {picking === item.id
                            ? "Adding"
                            : (group.actionLabel ?? "Add")}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
