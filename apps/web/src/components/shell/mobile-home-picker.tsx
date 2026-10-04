"use client";
import { useState } from "react";
import { usePathname } from "next/navigation";
import { ArrowUpRight } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import type { Role } from "@agent-hub/core";
import { MorphText } from "@/components/motion/morph-text";
import { ArcPicker, type ArcPickerOption } from "@/components/motion/arc-picker";
import { GLOBAL_NAV, SETUP_SECTIONS, assistantIdFromPath, setupHref } from "@/components/shell/nav";
import { SETTINGS_HOME, PERSONAL_SETTINGS_HOME } from "@/components/settings/settings-nav";
import { canManageMembers } from "@/lib/rbac";
import { SPRING_REFOLD, SPRING_UNFOLD } from "@/lib/ease";

export default function HomePicker({ role, open, onNavigate, onExitComplete }: {
  role: Role | null;
  open: boolean;
  onNavigate: (href: string) => void;
  onExitComplete: () => void;
}) {
  const reduce = useReducedMotion();
  const pathname = usePathname();
  const assistantId = assistantIdFromPath(pathname);
  const mayManage = canManageMembers(role);
  const destinations: ArcPickerOption[] = [
    ...GLOBAL_NAV.filter(item => item.id !== "settings" && (!item.adminOnly || mayManage)).flatMap(item => [
      { value: item.href, label: item.label },
      ...(item.id === "assistants" ? SETUP_SECTIONS.map(section => ({
        value: setupHref(assistantId, section.slug),
        label: section.label,
        ariaLabel: `Assistant · ${section.label}`,
        nested: true,
      })) : []),
    ]),
    ...(mayManage ? [{ value: SETTINGS_HOME, label: "Organization settings" }] : []),
    { value: PERSONAL_SETTINGS_HOME, label: "Personal settings" },
  ];
  // Some top-level entries share routes with their detailed sections.
  const options = destinations.map((item, index) => ({ ...item, value: String(index), href: item.value }));
  const [selected, setSelected] = useState(() => options.find(item => item.href === pathname)?.value ?? "0");
  const option = options.find(item => item.value === selected) ?? options[0];
  const activate = (value: string) => {
    const target = options.find(item => item.value === value);
    if (!target) return;
    onNavigate(target.href);
  };
  return <>
    <motion.section
      data-home-wheel
      inert={!open}
      initial="closed"
      animate={open ? "open" : "closed"}
      variants={{
        open: { x: "0%", rotate: 0, scale: 1, opacity: 1 },
        closed: { x: reduce ? "0%" : "-120%", rotate: reduce ? 0 : -8, scale: reduce ? 1 : 0.96, opacity: 0 },
      }}
      transition={reduce ? { duration: 0.12 } : open ? SPRING_UNFOLD : SPRING_REFOLD}
      onAnimationComplete={state => { if (state === "closed" && !open) onExitComplete(); }}
      className="mobile-home-rail relative z-10 flex min-h-0 flex-1 flex-col px-2 pb-24"
      aria-label="Workspace destinations"
    >
    <ArcPicker options={options} value={selected} onValueChange={setSelected} onActivate={activate} side="right" itemHeight={56} visibleCount={9} radius={480} className="my-3 min-h-0 flex-1" style={{ height: "auto" }} aria-label="Workspace navigation" />
    </motion.section>
    <motion.button initial={{ opacity: 0 }} animate={{ opacity: open ? 1 : 0 }} transition={{ duration: 0.12 }} disabled={!open} type="button" onClick={() => activate(selected)} aria-label={`Open ${option?.ariaLabel ?? option?.label ?? ""}`} className="mobile-home-open press-control fixed z-[70] flex items-center gap-2 rounded-full border bg-popover/90 px-4 text-left text-sm"><span className="min-w-0 flex-1 truncate"><MorphText text={`Open ${option?.ariaLabel ?? option?.label ?? ""}`} /></span><ArrowUpRight size={18} className="shrink-0" /></motion.button>
  </>;
}
