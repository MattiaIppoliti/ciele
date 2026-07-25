"use client";
// badtz-ui.com — Animated Card "Visual 2" (donut + orbiting tags). Adapted:
// fixed the arbitrary cubic-bezier easing classes for Tailwind v4, derived the
// donut progress straight from `hovered` (no setState-in-effect), and added a
// `label` slot so callers can replace the default caption card.

import * as React from "react";
import { useState } from "react";

interface Visual2Props {
  mainColor?: string;
  secondaryColor?: string;
  gridColor?: string;
  /** Replaces the default caption card in Layer2 (kept its slide-away-on-hover
   * behaviour). */
  label?: React.ReactNode;
}

export function Visual2({
  mainColor = "#8b5cf6",
  secondaryColor = "#fbbf24",
  gridColor = "#80808015",
  label,
}: Visual2Props) {
  const [hovered, setHovered] = useState(false);

  return (
    <>
      <div
        className="absolute inset-0 z-20"
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={
          {
            "--color": mainColor,
            "--secondary-color": secondaryColor,
          } as React.CSSProperties
        }
      />
      <div className="relative h-[180px] w-[356px] shrink-0 overflow-hidden rounded-t-lg">
        <Layer1
          hovered={hovered}
          color={mainColor}
          secondaryColor={secondaryColor}
        />
        <Layer2 color={mainColor} label={label} />
        <Layer3 color={mainColor} />
        <Layer4
          color={mainColor}
          secondaryColor={secondaryColor}
          hovered={hovered}
        />
        <EllipseGradient color={mainColor} />
        <GridLayer color={gridColor} />
      </div>
    </>
  );
}

interface LayerProps {
  color: string;
  secondaryColor?: string;
  hovered?: boolean;
}

const EllipseGradient: React.FC<{ color: string }> = ({ color }) => {
  return (
    <div className="absolute inset-0 z-[5] flex h-full w-full items-center justify-center">
      <svg
        width="356"
        height="196"
        viewBox="0 0 356 180"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <rect width="356" height="180" fill="url(#paint0_radial_v2)" />
        <defs>
          <radialGradient
            id="paint0_radial_v2"
            cx="0"
            cy="0"
            r="1"
            gradientUnits="userSpaceOnUse"
            gradientTransform="translate(178 98) rotate(90) scale(98 178)"
          >
            <stop stopColor={color} stopOpacity="0.25" />
            <stop offset="0.34" stopColor={color} stopOpacity="0.15" />
            <stop offset="1" stopOpacity="0" />
          </radialGradient>
        </defs>
      </svg>
    </div>
  );
};

const GridLayer: React.FC<{ color: string }> = ({ color }) => {
  return (
    <div
      style={{ "--grid-color": color } as React.CSSProperties}
      className="pointer-events-none absolute inset-0 z-[4] h-full w-full bg-transparent bg-[linear-gradient(to_right,var(--grid-color)_1px,transparent_1px),linear-gradient(to_bottom,var(--grid-color)_1px,transparent_1px)] [mask-image:radial-gradient(ellipse_50%_50%_at_50%_50%,#000_60%,transparent_100%)] bg-[size:20px_20px] bg-center opacity-70"
    />
  );
};

const Layer1: React.FC<LayerProps> = ({ hovered, color, secondaryColor }) => {
  const mainProgress = hovered ? 66 : 12.5;
  const secondaryProgress = hovered ? 100 : 0;

  const radius = 40;
  const circumference = 2 * Math.PI * radius;
  const mainDashoffset = circumference - (mainProgress / 100) * circumference;
  const secondaryDashoffset =
    circumference - (secondaryProgress / 100) * circumference;

  return (
    <div className="absolute left-0 top-0 z-[7] flex h-[360px] w-[356px] transform items-center justify-center transition-transform duration-500 ease-[cubic-bezier(0.6,0.6,0,1)] group-hover/animated-card:-translate-y-[90px] group-hover/animated-card:scale-110">
      <div className="relative flex h-[120px] w-[120px] items-center justify-center text-[#00000050] dark:text-white">
        <div className="relative">
          <svg width="120" height="120" viewBox="0 0 100 100">
            <circle
              cx="50"
              cy="50"
              r={radius}
              stroke="currentColor"
              strokeWidth="10"
              fill="transparent"
              opacity={0.2}
            />
            <circle
              cx="50"
              cy="50"
              r={radius}
              stroke={secondaryColor}
              strokeWidth="14"
              fill="transparent"
              strokeDasharray={circumference}
              strokeDashoffset={secondaryDashoffset}
              transform="rotate(-90 50 50)"
              style={{
                transition:
                  "stroke-dashoffset 0.5s cubic-bezier(0.6, 0.6, 0, 1)",
              }}
            />
            <circle
              cx="50"
              cy="50"
              r={radius}
              stroke={color}
              strokeWidth="14"
              fill="transparent"
              strokeDasharray={circumference}
              strokeDashoffset={mainDashoffset}
              transform="rotate(-90 50 50)"
              style={{
                transition:
                  "stroke-dashoffset 0.5s cubic-bezier(0.6, 0.6, 0, 1)",
              }}
            />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-xl text-black dark:text-white">
              {hovered ? secondaryProgress : mainProgress}%
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};

const Layer2: React.FC<{ color: string; label?: React.ReactNode }> = ({
  color,
  label,
}) => {
  return (
    <div
      className="relative h-full w-[356px]"
      style={{ "--color": color } as React.CSSProperties}
    >
      <div className="absolute inset-0 z-[6] flex w-[356px] translate-y-0 items-start justify-center bg-transparent p-4 transition-transform duration-500 ease-[cubic-bezier(0.6,0.6,0,1)] group-hover/animated-card:translate-y-full">
        {label ? (
          <div className="opacity-100 transition-opacity duration-500 ease-[cubic-bezier(0.6,0.6,0,1)] group-hover/animated-card:opacity-0">
            {label}
          </div>
        ) : (
          <div className="rounded-md border border-zinc-200 bg-white/25 px-2 py-1.5 opacity-100 backdrop-blur-sm transition-opacity duration-500 ease-[cubic-bezier(0.6,0.6,0,1)] group-hover/animated-card:opacity-0 dark:border-zinc-800 dark:bg-black/25">
            <div className="flex items-center gap-2">
              <div className="h-2 w-2 shrink-0 rounded-full bg-[var(--color)]" />
              <p className="text-xs text-black dark:text-white">
                Random Data Visualization
              </p>
            </div>
            <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
              Displaying some interesting stats.
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

const Layer3: React.FC<{ color: string }> = ({ color }) => {
  return (
    <div className="absolute inset-0 z-[6] flex translate-y-full items-center justify-center opacity-0 transition-all duration-500 ease-[cubic-bezier(0.6,0.6,0,1)] group-hover/animated-card:translate-y-0 group-hover/animated-card:opacity-100">
      <svg
        width="356"
        height="180"
        viewBox="0 0 356 180"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <rect width="356" height="180" fill="url(#paint0_linear_v2)" />
        <defs>
          <linearGradient
            id="paint0_linear_v2"
            x1="178"
            y1="0"
            x2="178"
            y2="180"
            gradientUnits="userSpaceOnUse"
          >
            <stop offset="0.35" stopColor={color} stopOpacity="0" />
            <stop offset="1" stopColor={color} stopOpacity="0.3" />
          </linearGradient>
        </defs>
      </svg>
    </div>
  );
};

const Layer4: React.FC<LayerProps> = ({ color, secondaryColor, hovered }) => {
  const items = [
    { id: 1, translateX: "100", translateY: "50", text: "Website" },
    { id: 2, translateX: "100", translateY: "-50", text: "iFrame" },
    { id: 3, translateX: "125", translateY: "0", text: "Pop-up" },
    { id: 4, translateX: "-125", translateY: "0", text: "WhatsApp" },
    { id: 5, translateX: "-100", translateY: "50", text: "Teams" },
    { id: 6, translateX: "-100", translateY: "-50", text: "Embed" },
  ];

  return (
    <div className="absolute inset-0 z-[7] flex items-center justify-center opacity-0 transition-opacity duration-500 ease-[cubic-bezier(0.6,0.6,0,1)] group-hover/animated-card:opacity-100">
      {items.map((item, index) => (
        <div
          key={item.id}
          className="absolute flex items-center justify-center gap-1 rounded-full border border-zinc-200 bg-white/70 px-1.5 py-0.5 backdrop-blur-sm transition-all duration-500 ease-[cubic-bezier(0.6,0.6,0,1)] dark:border-zinc-800 dark:bg-black/70"
          style={{
            transform: hovered
              ? `translate(${item.translateX}px, ${item.translateY}px)`
              : "translate(0px, 0px)",
          }}
        >
          <div
            className="h-1.5 w-1.5 rounded-full"
            style={{ backgroundColor: index < 3 ? color : secondaryColor }}
          />
          <span className="ml-1 text-[10px] text-black dark:text-white">
            {item.text}
          </span>
        </div>
      ))}
    </div>
  );
};
