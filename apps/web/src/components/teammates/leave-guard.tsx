"use client";

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  type MouseEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { useRouter } from "next/navigation";

/** Leave now, or after the page's own "Discard your changes?" confirm. */
type Leave = (go: () => void) => void;

const LeaveGuardContext = createContext<RefObject<Leave | null> | null>(null);

/**
 * Lets the Teammates rail ask the open page before it navigates away.
 *
 * The rail lives in the layout and the settings form in the page below it, so
 * a rail link used to drop an edited persona without a word while the form's
 * own breadcrumb asked first. A ref rather than state: registering a guard must
 * not re-render the whole rail on every keystroke that flips `dirty`.
 */
export function LeaveGuardProvider({ children }: { children: ReactNode }) {
  const guardRef = useRef<Leave | null>(null);
  return (
    <LeaveGuardContext.Provider value={guardRef}>
      {children}
    </LeaveGuardContext.Provider>
  );
}

/** Registers `leave` while `dirty`; a no-op outside the provider. */
export function useLeaveGuard(dirty: boolean, leave: Leave) {
  const guardRef = useContext(LeaveGuardContext);
  const latestRef = useRef(leave);
  useEffect(() => {
    latestRef.current = leave;
  });
  useEffect(() => {
    if (!guardRef || !dirty) return;
    const registered: Leave = (go) => latestRef.current(go);
    guardRef.current = registered;
    return () => {
      if (guardRef.current === registered) guardRef.current = null;
    };
  }, [guardRef, dirty]);
}

/** A link click handler that routes through the guard, keeping Cmd/Ctrl-click. */
export function useGuardedLinkClick() {
  const guardRef = useContext(LeaveGuardContext);
  const router = useRouter();
  return (event: MouseEvent<HTMLAnchorElement>, href: string) => {
    const leave = guardRef?.current;
    if (
      !leave ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey ||
      event.button !== 0
    ) {
      return;
    }
    event.preventDefault();
    leave(() => router.push(href));
  };
}
