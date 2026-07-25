"use client";

import type { ComponentType, HTMLAttributes, ReactNode, Ref } from "react";
import { createContext, createElement, useContext, useEffect, useRef } from "react";

import {
  Activity,
  AlignLeft,
  Archive,
  ArrowRight,
  ArrowUp,
  AtSign,
  Bell,
  Bold,
  BookText,
  Brain,
  Building2,
  ChartLine,
  CircleDashed,
  ChartNoAxesColumnIncreasing,
  ChevronsUpDown,
  CircleCheck,
  CircleHelp,
  Clock,
  CloudCog,
  Compass,
  CloudUpload,
  Copy,
  CopyPlus,
  CornerDownLeft,
  Download,
  FileText,
  Fingerprint,
  FlaskConical,
  GalleryVerticalEnd,
  Gauge,
  GripVertical,
  History,
  Italic,
  Key,
  LayoutGrid,
  LifeBuoy,
  Lock,
  MessageCircle,
  MessageSquare,
  MessageSquareDashed,
  Mic,
  Monitor,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  PenTool,
  Phone,
  PhoneCall,
  Plane,
  PlugZap,
  Plus,
  RefreshCw,
  Rocket,
  RotateCcw,
  RotateCw,
  Route,
  Search,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  SquarePen,
  Sun,
  Trash2,
  TrendingUp,
  Unplug,
  Upload,
  User,
  Users,
  Webhook,
  Workflow,
  Wrench,
  X,
  type LucideIcon,
} from "lucide-react";

import { ActivityIcon } from "@/components/ui/activity";
import { AirplaneIcon } from "@/components/ui/airplane";
import { AlignLeftIcon } from "@/components/ui/align-left";
import { ArchiveIcon } from "@/components/ui/archive";
import { ArrowRightIcon } from "@/components/ui/arrow-right";
import { ArrowUpIcon } from "@/components/ui/arrow-up";
import { AtSignIcon } from "@/components/ui/at-sign";
import { BellIcon } from "@/components/ui/bell";
import { BoldIcon } from "@/components/ui/bold";
import { BookTextIcon } from "@/components/ui/book-text";
import { BrainIcon } from "@/components/ui/brain";
import { BuildingOffice2Icon } from "@/components/ui/building-office-2";
import { ChartLineIcon } from "@/components/ui/chart-line";
import { ChartNoAxesColumnIncreasingIcon } from "@/components/ui/chart-no-axes-column-increasing";
import { CircleCheckIcon } from "@/components/ui/circle-check";
import { CircleDashedIcon } from "@/components/ui/circle-dashed";
import { CircleHelpIcon } from "@/components/ui/circle-help";
import { ClockIcon } from "@/components/ui/clock";
import { CloudCogIcon } from "@/components/ui/cloud-cog";
import { CloudUploadIcon } from "@/components/ui/cloud-upload";
import { CompassIcon } from "@/components/ui/compass";
import { ConnectIcon } from "@/components/ui/connect";
import { ChevronsUpDownIcon } from "@/components/ui/chevrons-up-down";
import { CopyIcon } from "@/components/ui/copy";
import { CornerDownLeftIcon } from "@/components/ui/corner-down-left";
import { DeleteIcon } from "@/components/ui/delete";
import { DocumentDuplicateIcon } from "@/components/ui/document-duplicate";
import { DownloadIcon } from "@/components/ui/download";
import { FileTextIcon } from "@/components/ui/file-text";
import { FingerprintIcon } from "@/components/ui/fingerprint";
import { FlaskIcon } from "@/components/ui/flask";
import { GalleryVerticalEndIcon } from "@/components/ui/gallery-vertical-end";
import { GaugeIcon } from "@/components/ui/gauge";
import { GripVerticalIcon } from "@/components/ui/grip-vertical";
import { HistoryIcon } from "@/components/ui/history";
import { ItalicIcon } from "@/components/ui/italic";
import { KeyIcon } from "@/components/ui/key";
import { LayoutGridIcon } from "@/components/ui/layout-grid";
import { LifebuoyIcon } from "@/components/ui/lifebuoy";
import { LockIcon } from "@/components/ui/lock";
import { MessageCircleIcon } from "@/components/ui/message-circle";
import { MessageSquareIcon } from "@/components/ui/message-square";
import { MessageSquareDashedIcon } from "@/components/ui/message-square-dashed";
import { MicIcon } from "@/components/ui/mic";
import { ComputerDesktopIcon } from "@/components/ui/computer-desktop";
import { MoonIcon } from "@/components/ui/moon";
import { PanelLeftCloseIcon } from "@/components/ui/panel-left-close";
import { PanelLeftOpenIcon } from "@/components/ui/panel-left-open";
import { PenToolIcon } from "@/components/ui/pen-tool";
import { PhoneIcon } from "@/components/ui/phone";
import { PhoneCallIcon } from "@/components/ui/phone-call";
import { PlugZapIcon } from "@/components/ui/plug-zap";
import { PlusIcon } from "@/components/ui/plus";
import { RefreshCWIcon } from "@/components/ui/refresh-cw";
import { RocketIcon } from "@/components/ui/rocket";
import { RotateCCWIcon } from "@/components/ui/rotate-ccw";
import { RotateCWIcon } from "@/components/ui/rotate-cw";
import { RouteIcon } from "@/components/ui/route";
import { SearchIcon } from "@/components/ui/search";
import { SettingsIcon } from "@/components/ui/settings";
import { ShieldCheckIcon } from "@/components/ui/shield-check";
import { SlidersHorizontalIcon } from "@/components/ui/sliders-horizontal";
import { SparklesIcon } from "@/components/ui/sparkles";
import { SquarePenIcon } from "@/components/ui/square-pen";
import { SunIcon } from "@/components/ui/sun";
import { TrendingUpIcon } from "@/components/ui/trending-up";
import { UploadIcon } from "@/components/ui/upload";
import { UserIcon } from "@/components/ui/user";
import { UsersIcon } from "@/components/ui/users";
import { WebhookIcon } from "@/components/ui/webhook";
import { WorkflowIcon } from "@/components/ui/workflow";
import { WrenchIcon } from "@/components/ui/wrench";
import { XIcon } from "@/components/ui/x";
import { cn } from "@/lib/utils";

/**
 * Imperative handle every `@lucide-animated` icon exposes. Providing a ref
 * flips the icon into "controlled" mode: its own hover listeners go quiet and
 * we drive the animation ourselves from the nearest interactive ancestor.
 */
export interface AnimatedIconHandle {
  startAnimation: () => void;
  stopAnimation: () => void;
}

type AnimatedIconComponent = ComponentType<
  HTMLAttributes<HTMLDivElement> & {
    size?: number;
    ref?: Ref<AnimatedIconHandle>;
  }
>;

/**
 * lucide-react icon → its `@lucide-animated` counterpart. Keyed by the
 * component reference itself (not display name — lucide aliases some, e.g.
 * `CircleHelp` renders as `CircleQuestionMark`). Only icons with an animated
 * equivalent live here; everything else falls back to the static lucide icon.
 * Extend this as more animated icons are installed.
 */
const ANIMATED = new Map<LucideIcon, AnimatedIconComponent>([
  [Activity, ActivityIcon],
  [AlignLeft, AlignLeftIcon],
  [Archive, ArchiveIcon],
  [ArrowRight, ArrowRightIcon],
  [ArrowUp, ArrowUpIcon],
  [AtSign, AtSignIcon],
  [Bell, BellIcon],
  [Bold, BoldIcon],
  [BookText, BookTextIcon],
  [Brain, BrainIcon],
  [Building2, BuildingOffice2Icon],
  [ChartLine, ChartLineIcon],
  [ChartNoAxesColumnIncreasing, ChartNoAxesColumnIncreasingIcon],
  [ChevronsUpDown, ChevronsUpDownIcon],
  [CircleCheck, CircleCheckIcon],
  [CircleDashed, CircleDashedIcon],
  [Compass, CompassIcon],
  [CloudCog, CloudCogIcon],
  [CircleHelp, CircleHelpIcon],
  [Clock, ClockIcon],
  [CloudUpload, CloudUploadIcon],
  [Copy, CopyIcon],
  [CopyPlus, DocumentDuplicateIcon],
  [CornerDownLeft, CornerDownLeftIcon],
  [Download, DownloadIcon],
  [FileText, FileTextIcon],
  [Fingerprint, FingerprintIcon],
  [FlaskConical, FlaskIcon],
  [GalleryVerticalEnd, GalleryVerticalEndIcon],
  [Gauge, GaugeIcon],
  [GripVertical, GripVerticalIcon],
  [Key, KeyIcon],
  [History, HistoryIcon],
  [Italic, ItalicIcon],
  [LayoutGrid, LayoutGridIcon],
  [LifeBuoy, LifebuoyIcon],
  [Lock, LockIcon],
  [MessageCircle, MessageCircleIcon],
  [MessageSquare, MessageSquareIcon],
  [MessageSquareDashed, MessageSquareDashedIcon],
  [Mic, MicIcon],
  [Monitor, ComputerDesktopIcon],
  [Moon, MoonIcon],
  [PanelLeftClose, PanelLeftCloseIcon],
  [PanelLeftOpen, PanelLeftOpenIcon],
  [PenTool, PenToolIcon],
  [Phone, PhoneIcon],
  [Plane, AirplaneIcon],
  [PhoneCall, PhoneCallIcon],
  [PlugZap, PlugZapIcon],
  [Plus, PlusIcon],
  [RefreshCw, RefreshCWIcon],
  [Rocket, RocketIcon],
  [RotateCcw, RotateCCWIcon],
  [RotateCw, RotateCWIcon],
  [Route, RouteIcon],
  [Search, SearchIcon],
  [Settings, SettingsIcon],
  [ShieldCheck, ShieldCheckIcon],
  [SlidersHorizontal, SlidersHorizontalIcon],
  [Sparkles, SparklesIcon],
  [SquarePen, SquarePenIcon],
  [Sun, SunIcon],
  [Trash2, DeleteIcon],
  [TrendingUp, TrendingUpIcon],
  [Unplug, ConnectIcon],
  [Upload, UploadIcon],
  [User, UserIcon],
  [Users, UsersIcon],
  [Webhook, WebhookIcon],
  [Workflow, WorkflowIcon],
  [Wrench, WrenchIcon],
  [X, XIcon],
]);

const HOST_SELECTOR =
  "a,button,[role='button'],[role='menuitem'],[data-animate-group]";

/** Small lead-in before a hovered icon starts animating. */
const START_DELAY_MS = 135;

/**
 * Whether icons in this subtree may animate. Defaults to `true` (the shell —
 * sidebar, top bar, menus). The central page content wraps itself in
 * `<StaticIcons>` so its icons render as the plain, static lucide glyphs.
 */
const AnimateIconsContext = createContext(true);

/** Renders its subtree's animated icons as static lucide glyphs. */
export function StaticIcons({ children }: { children: ReactNode }) {
  return (
    <AnimateIconsContext.Provider value={false}>
      {children}
    </AnimateIconsContext.Provider>
  );
}

interface AnimatedIconProps extends HTMLAttributes<HTMLSpanElement> {
  /** The lucide-react icon; auto-upgraded to its animated twin when available. */
  icon: LucideIcon;
  /** Pixel size passed to both the animated and static renderers. */
  size?: number;
  /** Classes for the icon glyph itself (color, margins) — not the wrapper. */
  iconClassName?: string;
  /**
   * When to play: `"hover"` (default) drives from the nearest interactive
   * ancestor so hovering the whole control animates; `"none"` never auto-plays.
   */
  animateOn?: "hover" | "none";
}

/**
 * Drop-in replacement for a lucide-react icon that animates on hover when an
 * animated equivalent exists. Usage mirrors lucide: pass the icon component and
 * a `size`; keep color/margin utilities in `iconClassName`. Sizing goes through
 * the `size` prop (animated icons size their SVG by attribute, not by class).
 */
export function AnimatedIcon({
  icon: Icon,
  size = 16,
  iconClassName,
  animateOn = "hover",
  className,
  ...spanProps
}: AnimatedIconProps) {
  const handleRef = useRef<AnimatedIconHandle>(null);
  const hostRef = useRef<HTMLSpanElement>(null);
  const animate = useContext(AnimateIconsContext);
  const Animated = animate ? ANIMATED.get(Icon) : undefined;

  useEffect(() => {
    if (!Animated || animateOn !== "hover") return;
    // Respect reduced-motion: leave the icon static (no listeners, no work).
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const span = hostRef.current;
    if (!span) return;
    const host = span.closest(HOST_SELECTOR) ?? span;
    // Tiny delay before playing so the animation feels intentional rather than
    // firing the instant the pointer grazes the control. Cancelled on leave.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const start = () => {
      timer = setTimeout(() => handleRef.current?.startAnimation(), START_DELAY_MS);
    };
    const stop = () => {
      clearTimeout(timer);
      handleRef.current?.stopAnimation();
    };
    host.addEventListener("mouseenter", start);
    host.addEventListener("mouseleave", stop);
    return () => {
      clearTimeout(timer);
      host.removeEventListener("mouseenter", start);
      host.removeEventListener("mouseleave", stop);
    };
  }, [Animated, animateOn]);

  if (!Animated) {
    return <Icon size={size} className={cn(className, iconClassName)} />;
  }

  return (
    <span ref={hostRef} className={cn("inline-flex", className)} {...spanProps}>
      {createElement(Animated, {
        ref: handleRef,
        size,
        className: cn(iconClassName),
      })}
    </span>
  );
}
