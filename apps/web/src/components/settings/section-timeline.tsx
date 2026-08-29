"use client";

import {
  createContext,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";

type RailContext = {
  activeId: string | null;
  register: (id: string, el: HTMLElement) => () => void;
};

const SectionRailContext = createContext<RailContext | null>(null);

/**
 * Vertical settings rail: a faded line runs down the left gutter with one dot
 * per section. While scrolling, the section whose heading sits closest under
 * the top of the viewport gets the emphasized dot; the others stay faded.
 */
export function SectionTimeline({ children }: { children: ReactNode }) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const sectionsRef = useRef(new Map<string, HTMLElement>());
  const frameRef = useRef(0);

  useEffect(() => {
    const pickActive = () => {
      frameRef.current = 0;
      const entries = [...sectionsRef.current.entries()];
      if (entries.length === 0) return;
      // Active = last section whose top has crossed the activation line
      // (a band below the viewport top), falling back to the first one.
      const activationLine = window.innerHeight * 0.3;
      let current = entries[0][0];
      for (const [id, el] of entries) {
        if (el.getBoundingClientRect().top <= activationLine) current = id;
      }
      setActiveId(current);
    };
    const onScroll = () => {
      if (frameRef.current) return;
      frameRef.current = requestAnimationFrame(pickActive);
    };
    pickActive();
    // Capture phase: the admin shell scrolls a nested container, not window.
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
    };
  }, []);

  const register = (id: string, el: HTMLElement) => {
    sectionsRef.current.set(id, el);
    return () => {
      sectionsRef.current.delete(id);
    };
  };

  return (
    <SectionRailContext.Provider value={{ activeId, register }}>
      <div className="relative">
        <div
          aria-hidden
          className="via-border absolute top-3 bottom-3 left-[5.5px] w-px bg-gradient-to-b from-transparent to-transparent"
        />
        {children}
      </div>
    </SectionRailContext.Provider>
  );
}

export function TimelineSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  const id = useId();
  const ctx = useContext(SectionRailContext);
  const ref = useRef<HTMLElement>(null);

  const register = ctx?.register;
  useEffect(() => {
    if (!register || !ref.current) return;
    return register(id, ref.current);
  }, [register, id]);

  const active = ctx?.activeId === id;

  return (
    <section ref={ref} className="relative pt-2 pb-12 pl-10 last:pb-4">
      <span
        aria-hidden
        className={`absolute top-[13px] left-0 size-3 rounded-full border-2 transition-all duration-300 ${
          active
            ? "border-foreground bg-background scale-110"
            : "border-muted-foreground/35 bg-background"
        }`}
      />
      <h2
        className={`text-lg font-semibold transition-colors duration-300 ${
          active ? "text-foreground" : "text-muted-foreground/60"
        }`}
      >
        {title}
      </h2>
      <div
        className={`mt-5 transition-opacity duration-300 ${
          active ? "opacity-100" : "opacity-70"
        }`}
      >
        {children}
      </div>
    </section>
  );
}
