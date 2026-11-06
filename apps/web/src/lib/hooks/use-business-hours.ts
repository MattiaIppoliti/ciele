"use client";
import { useEffect, useState } from "react";
import type { BusinessHours } from "@agent-hub/core";
import { listBusinessHoursAction } from "@/app/(admin)/settings/business-hours/actions";

/** Live organization settings shared by the channel and Flow editors. */
export function useBusinessHours() {
  const [state, setState] = useState<{ items: BusinessHours[]; defaultTimezone: string; available: boolean; loading: boolean; error: string | null }>({ items: [], defaultTimezone: "UTC", available: false, loading: true, error: null });
  useEffect(() => {
    let active = true;
    void listBusinessHoursAction().then(result => {
      if (!active) return;
      setState(result.ok ? { ...result.value, loading: false, error: null } : { items: [], defaultTimezone: "UTC", available: false, loading: false, error: result.error });
    }).catch(() => {
      if (active) setState(previous => ({ ...previous, loading: false, error: "Business hours could not be loaded" }));
    });
    return () => { active = false; };
  }, []);
  return state;
}
