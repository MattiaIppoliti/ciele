"use client";

import {
  BellRing,
  Braces,
  ChartLine,
  CircleCheck,
  ClipboardList,
  Clock,
  Code2,
  Download,
  Eye,
  FileText,
  Filter,
  Flag,
  Globe,
  Layers,
  Link2,
  Lock,
  MessageCircle,
  MessagesSquare,
  Monitor,
  Palette,
  PanelsTopLeft,
  Phone,
  Scale,
  ShieldCheck,
  Sparkles,
  SquareKanban,
  Table2,
  Users,
  Workflow,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { Spotlight } from "@/components/core/spotlight";
import type { FeatureEntry } from "@/components/marketing/feature-catalog";

/* The three supporting points under a feature's screenshot, as cards.
   Positional by design: one icon per point, in the order the catalogue lists
   them, so the copy stays prose in a data file and the drawing stays here.
   Add a point, add an icon. */
const POINT_ICONS: Record<string, LucideIcon[]> = {
  assistants: [Users, PanelsTopLeft, MessageCircle],
  knowledge: [Globe, FileText, Link2],
  flows: [Zap, Filter, Workflow],
  "help-desks": [Phone, ClipboardList, Clock],
  publishing: [Code2, Layers, Palette],
  inbox: [MessagesSquare, Monitor, Download],
  improvements: [Flag, Sparkles, SquareKanban],
  insights: [ChartLine, Scale, Table2],
  authentication: [Lock, ShieldCheck, Braces],
  alerts: [BellRing, CircleCheck, Eye],
};

/** The block's own spring: short, barely bouncy, the same for every card. */
const SPRING = { type: "spring" as const, bounce: 0.1, duration: 0.25 };

export function FeaturePoints({ feature }: { feature: FeatureEntry }) {
  const reduceMotion = useReducedMotion();
  const icons = POINT_ICONS[feature.slug] ?? [];

  return (
    <div className="grid gap-4 sm:grid-cols-3">
      {feature.points.map((point, index) => {
        const Icon = icons[index];
        return (
          <motion.div
            key={point.title}
            /* The home page's card treatment: a translucent grey rim drawn as
               a 1.5px inset behind an opaque face, lit by a cursor-following
               spotlight that only shows through that rim. */
            className="relative overflow-hidden rounded-2xl bg-zinc-300/30 p-[1.5px] dark:bg-zinc-700/30"
            initial={reduceMotion ? { opacity: 1 } : { opacity: 0, scale: 0.96 }}
            whileInView={reduceMotion ? { opacity: 1 } : { opacity: 1, scale: 1 }}
            viewport={{ once: true, margin: "-80px" }}
            transition={reduceMotion ? { duration: 0 } : { ...SPRING, delay: index * 0.05 }}
          >
            <Spotlight
              className="from-sky-400 via-indigo-500 to-transparent blur-2xl dark:from-sky-300 dark:via-indigo-400"
              size={220}
            />
            <div className="bg-card relative flex h-full flex-col rounded-[calc(1rem-1.5px)] p-6">
              {Icon && (
                // Same grey as the icons in the nav and the mocks: a bordered
                // muted tile, never a coloured badge.
                <span className="bg-muted mb-5 flex size-9 items-center justify-center rounded-lg border">
                  <Icon className="text-muted-foreground size-4" strokeWidth={1.75} />
                </span>
              )}
              {/* font-sans: the marketing layout sets every heading in the
                  serif display face, which at 14px beside the body copy read
                  as two typefaces arguing. */}
              <h2 className="text-foreground font-sans text-sm font-medium">{point.title}</h2>
              <p className="text-muted-foreground mt-2 text-sm leading-relaxed">{point.body}</p>
            </div>
          </motion.div>
        );
      })}
    </div>
  );
}
