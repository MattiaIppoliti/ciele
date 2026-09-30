"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { useUnderlyingPathname } from "@/components/shell/use-underlying-pathname";

/**
 * What a page puts in the top bar, and the one way it gets there.
 *
 * A page owns its title override (a breadcrumb of its own), its actions, its
 * form's Cancel and Save and the name of its last crumb; the bar, in the shell
 * above it, draws them. Its toolbar (search, filters, export) is a `SlotPortal`. Pages write
 * through a context whose value never changes, so registering never re-renders
 * the page or anything else in the shell: only the bar reads what was written.
 *
 * The bar's rules live here once: nothing a page wrote is drawn before the bar
 * has hydrated (the server HTML never contains it), and a crumb name is kept
 * only on the route that registered it, so a navigation drops it without an
 * effect.
 */

/** The three places a page can put a node. */
export type TopBarSlot = "title" | "actions" | "form";

type Nodes = Record<TopBarSlot, ReactNode | null>;

interface Writers {
  setSlot: (slot: TopBarSlot, node: ReactNode | null) => void;
  setCrumb: (crumb: { path: string; label: string } | null) => void;
}

interface Content {
  nodes: Nodes;
  crumb: { path: string; label: string } | null;
}

const WritersContext = createContext<Writers | null>(null);
const ContentContext = createContext<Content | null>(null);

const EMPTY: Nodes = { title: null, actions: null, form: null };

export function TopBarSlotsProvider({ children }: { children: ReactNode }) {
  const [nodes, setNodes] = useState<Nodes>(EMPTY);
  const [crumb, setCrumb] = useState<Content["crumb"]>(null);
  const writers = useMemo<Writers>(
    () => ({
      setSlot: (slot, node) => setNodes((current) => ({ ...current, [slot]: node })),
      setCrumb,
    }),
    []
  );
  const content = useMemo<Content>(
    () => ({ nodes, crumb }),
    [nodes, crumb]
  );
  return (
    <WritersContext.Provider value={writers}>
      <ContentContext.Provider value={content}>{children}</ContentContext.Provider>
    </WritersContext.Provider>
  );
}

function useWriters(): Writers {
  const writers = useContext(WritersContext);
  if (!writers) throw new Error("Top-bar slots are written inside TopBarSlotsProvider");
  return writers;
}

/**
 * The stable writer for the three node slots. Set a node from an effect and
 * set `null` in its cleanup; the value never changes, so it is safe in deps.
 */
export function useSetTopBarSlot(): Writers["setSlot"] {
  return useWriters().setSlot;
}

const subscribeNoop = () => () => {};

/** What the bar draws. Nodes are null until the bar has hydrated. */
export function useTopBarContent(): {
  title: ReactNode | null;
  actions: ReactNode | null;
  form: ReactNode | null;
  /** The page's own name for its last crumb, on the route that set it. */
  crumbLabel: string | null;
} {
  const content = useContext(ContentContext);
  if (!content) throw new Error("The top bar reads inside TopBarSlotsProvider");
  const pathname = useUnderlyingPathname();
  // Pages register from effects, so with selective hydration a node can be set
  // before the bar hydrates. Drawing it only after keeps both trees identical.
  const mounted = useSyncExternalStore(
    subscribeNoop,
    () => true,
    () => false
  );
  const nodes = mounted ? content.nodes : EMPTY;
  return {
    ...nodes,
    crumbLabel: content.crumb?.path === pathname ? content.crumb.label : null,
  };
}

/**
 * Names the page you are on in the breadcrumb, for the pages whose subject the
 * URL cannot name (a help desk's name, an improvement's title). Renders
 * nothing.
 */
export function PageCrumb({ label }: { label: string }) {
  const pathname = useUnderlyingPathname();
  const { setCrumb } = useWriters();
  useEffect(() => {
    setCrumb({ path: pathname, label });
    return () => setCrumb(null);
  }, [pathname, label, setCrumb]);
  return null;
}
