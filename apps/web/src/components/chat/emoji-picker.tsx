"use client";

import { Button as CieleButton } from "@agent-hub/ui";
import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { Car, ChevronLeft, Clock, Flag, Hand, Heart, Lightbulb, PawPrint, Search, Smile, Utensils, Volleyball, X } from "lucide-react";
import { EMOJI_CATALOG, EMOJI_CATEGORIES, searchEmoji, type PickerEmoji } from "@/lib/emoji-catalog";
import { cn } from "@/lib/utils";

const categoryIcons = [Smile, Hand, PawPrint, Utensils, Volleyball, Car, Lightbulb, Heart, Flag];
const suggested = ["😀", "👍", "❤️", "🎉", "🚀", "👀", "🙏", "🔥"];

export default function EmojiPicker({ onSelect, onBack, selected, disabled }: {
  onSelect: (emoji: string) => void;
  onBack: () => void;
  selected: readonly string[];
  disabled: boolean;
}) {
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [category, setCategory] = useState("suggested");
  const input = useRef<HTMLInputElement>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const matches = useMemo(() => searchEmoji(deferredQuery), [deferredQuery]);
  const suggestions = useMemo(() => suggested.flatMap((native) => {
    const emoji = EMOJI_CATALOG.find((entry) => entry.native === native);
    return emoji ? [emoji] : [];
  }), []);
  useEffect(() => { input.current?.focus(); }, []);

  function jump(id: string) {
    setQuery("");
    setCategory(id);
    requestAnimationFrame(() => {
      const section = scroll.current?.querySelector<HTMLElement>(`[data-emoji-category="${id}"]`);
      if (section && scroll.current) scroll.current.scrollTo({ top: section.offsetTop, behavior: "instant" });
    });
  }

  function grid(emojis: readonly PickerEmoji[]) {
    return (
      <div className="grid grid-cols-8 gap-0.5" onKeyDown={(event) => {
        if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
        event.preventDefault(); event.stopPropagation();
        const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
        const index = buttons.findIndex((button) => button === document.activeElement);
        const step = event.key === "ArrowUp" ? -8 : event.key === "ArrowDown" ? 8 : event.key === "ArrowLeft" ? -1 : 1;
        const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : Math.max(0, Math.min(buttons.length - 1, index + step));
        buttons[next]?.focus();
      }}>
        {emojis.map((emoji) => (
          <button key={emoji.id} type="button" aria-label={emoji.name} title={emoji.name} aria-pressed={selected.includes(emoji.native)} disabled={disabled} onClick={() => onSelect(emoji.native)} className={cn("press-control grid aspect-square w-full place-items-center rounded-lg text-2xl leading-none hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50", selected.includes(emoji.native) && "bg-muted ring-1 ring-border")}>
            <span aria-hidden>{emoji.native}</span>
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className="flex max-h-[min(420px,calc(100dvh-32px))] flex-col">
      <div className="flex shrink-0 items-center gap-1.5 px-2.5 pt-2.5">
        <CieleButton variant="ghost" size="icon-sm" type="button" aria-label="Back to quick reactions" onClick={onBack} className="press-control grid size-7 shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"><ChevronLeft className="size-4" /></CieleButton>
        <div className="relative min-w-0 flex-1">
          <Search aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <input ref={input} type="search" aria-label="Search emojis" placeholder="Search emojis" maxLength={64} value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => {
            if (event.key === "Enter" && query.trim() && matches[0] && !disabled) { event.preventDefault(); onSelect(matches[0].native); }
          }} className="h-9 w-full min-w-0 rounded-xl border bg-muted/40 pl-8 pr-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring [&::-webkit-search-cancel-button]:cursor-pointer" />
        </div>
        {query && <CieleButton variant="ghost" size="icon-sm" type="button" aria-label="Clear emoji search" onClick={() => { setQuery(""); input.current?.focus(); }} className="press-control grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-muted"><X className="size-3.5" /></CieleButton>}
      </div>
      <div role="toolbar" aria-label="Emoji categories" className="flex shrink-0 items-center justify-between gap-0.5 px-3 py-2">
        <CieleButton variant="ghost" size="icon-sm" type="button" aria-label="Suggested" aria-pressed={!query && category === "suggested"} onClick={() => jump("suggested")} className={cn("press-control grid size-6 place-items-center rounded-md text-muted-foreground hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring", !query && category === "suggested" && "bg-muted text-foreground")}><Clock className="size-3.5" /></CieleButton>
        {EMOJI_CATEGORIES.map((entry, index) => {
          const Icon = categoryIcons[index] ?? Smile;
          return <CieleButton variant="ghost" size="icon-sm" key={entry.id} type="button" aria-label={entry.name} title={entry.name} aria-pressed={!query && category === entry.id} onClick={() => jump(entry.id)} className={cn("press-control grid size-6 place-items-center rounded-md text-muted-foreground hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring", !query && category === entry.id && "bg-muted text-foreground")}><Icon className="size-3.5" /></CieleButton>;
        })}
      </div>
      <div ref={scroll} className="relative min-h-0 overflow-y-auto overscroll-contain px-3 pb-3" aria-busy={query !== deferredQuery}>
        {query.trim() ? (
          <section aria-label="Search results">
            <p role="status" className="mb-1.5 text-xs text-muted-foreground">{matches.length ? `${matches.length} emoji found` : "No emoji found. Try another word."}</p>
            {grid(matches)}
          </section>
        ) : [ { id: "suggested", name: "Suggested", emojis: suggestions }, ...EMOJI_CATEGORIES ].map((entry) => (
          <section key={entry.id} data-emoji-category={entry.id} aria-label={entry.name} className="mb-3 last:mb-0">
            <h3 className="mb-1.5 text-xs font-medium text-muted-foreground">{entry.name}</h3>
            {grid(entry.emojis)}
          </section>
        ))}
      </div>
    </div>
  );
}
