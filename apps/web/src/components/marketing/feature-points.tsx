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
import type { FeatureEntry } from "@/components/marketing/feature-catalog";
import { SpotlightCard } from "@/components/marketing/spotlight-card";

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

export function FeaturePoints({ feature }: { feature: FeatureEntry }) {
  const icons = POINT_ICONS[feature.slug] ?? [];

  return (
    <div className="grid gap-4 sm:grid-cols-3">
      {feature.points.map((point, index) => {
        const Icon = icons[index];
        return (
          <SpotlightCard key={point.title} index={index}>
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
          </SpotlightCard>
        );
      })}
    </div>
  );
}
