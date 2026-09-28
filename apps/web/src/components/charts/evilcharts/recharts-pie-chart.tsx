"use client";
// Vendored from EvilCharts, trimmed to what Ciele's callers use.

import {
  createContext,
  use,
  useId,
  useMemo,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";
import {
  Pie as RechartsPie,
  PieChart as RechartsPieChart,
  Sector,
  type PieSectorShapeProps,
} from "recharts";
import { ChartTooltip, ChartTooltipContent } from "@/components/charts/evilcharts/ui/recharts-tooltip";
import {
  type ChartConfig,
  ChartContainer,
  getColorsCount,
  LoadingIndicator,
} from "@/components/charts/evilcharts/ui/recharts-chart";
import { motion } from "motion/react";

// Constants
const LOADING_SECTORS = 5;
const LOADING_ANIMATION_DURATION = 2000; // full loading cycle duration in milliseconds
const OUTER_RADIUS = "80%";
const START_ANGLE = 0;
const END_ANGLE = 360;

// ─────────────────────────────────────────────────────────────────────────────
// Shared context
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Shared state for every part of the chart. Lifted into <EvilPieChart /> so that
 * <Pie /> and <Tooltip /> can read it without prop drilling.
 */
type PieChartContextValue = {
  config: ChartConfig; // colors + labels for every sector
  data: Record<string, unknown>[]; // rows rendered by the chart
  dataKey: string; // key holding each sector's numeric value
  nameKey: string; // key holding each sector's name
  isLoading: boolean; // whether the chart shows its loading skeleton
  selectedSector: string | null; // currently selected sector name, or null when none
  selectSector: (sectorName: string | null) => void; // sets the selected sector
};

const PieChartContext = createContext<PieChartContextValue | null>(null);

// Reads the chart context, throwing a helpful error when used outside <EvilPieChart />
function usePieChart() {
  const context = use(PieChartContext);

  if (!context) {
    throw new Error("Pie chart parts (<Pie />, <Tooltip />) must be used within <EvilPieChart />");
  }

  return context;
}

// ─────────────────────────────────────────────────────────────────────────────
// Root container
// ─────────────────────────────────────────────────────────────────────────────

type EvilPieChartProps<TData extends Record<string, unknown>> = {
  config: ChartConfig; // sector colors + labels
  data: TData[]; // rows rendered by the chart
  dataKey: keyof TData & string; // key holding each sector's numeric value
  nameKey: keyof TData & string; // key holding each sector's name
  children: ReactNode; // composed parts: <Pie />, <Tooltip />
  className?: string; // extra classes for the chart container
  isLoading?: boolean; // shows the animated loading skeleton
};

/**
 * Root of the composible pie chart. Owns the data, the shared context, and the
 * loading skeleton. The pie itself and the tooltip are composed as children.
 */
export function EvilPieChart<TData extends Record<string, unknown>>({
  config,
  data,
  dataKey,
  nameKey,
  children,
  className,
  isLoading = false,
}: EvilPieChartProps<TData>) {
  const [selectedSector, setSelectedSector] = useState<string | null>(null);

  const contextValue = useMemo<PieChartContextValue>(
    () => ({
      config,
      data,
      dataKey,
      nameKey,
      isLoading,
      selectedSector,
      selectSector: setSelectedSector,
    }),
    [config, data, dataKey, nameKey, isLoading, selectedSector],
  );

  return (
    <PieChartContext value={contextValue}>
      <ChartContainer className={className} config={config}>
        <LoadingIndicator isLoading={isLoading} />
        <RechartsPieChart id="evil-charts-pie-chart" accessibilityLayer>
          {children}
        </RechartsPieChart>
      </ChartContainer>
    </PieChartContext>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Composible parts
// ─────────────────────────────────────────────────────────────────────────────

type PieProps = {
  innerRadius?: number | string; // inner radius — set above 0 for a donut
  cornerRadius?: number; // border-radius of each sector in pixels
  paddingAngle?: number; // gap between sectors in degrees — negative overlaps them
  isClickable?: boolean; // lets sectors be selected by clicking them
};

/**
 * The pie series. Self-contained: it generates its own color gradients under a
 * unique id, so any number of pies can live on one page without style
 * collisions. While the chart is loading it renders an animated skeleton in
 * place of the data.
 */
function Pie({ innerRadius = 0, cornerRadius = 0, paddingAngle = 0, isClickable = false }: PieProps) {
  const { config, data, dataKey, nameKey, isLoading, selectedSector, selectSector } = usePieChart();
  const id = useId().replace(/:/g, ""); // unique id scopes this pie's style defs

  if (isLoading) {
    return (
      <RechartsPie
        data={LOADING_PIE_DATA}
        dataKey="value"
        nameKey="name"
        innerRadius={innerRadius}
        outerRadius={OUTER_RADIUS}
        cornerRadius={cornerRadius}
        paddingAngle={paddingAngle}
        startAngle={START_ANGLE}
        endAngle={END_ANGLE}
        strokeWidth={0}
        isAnimationActive={false}
        shape={(props) => <AnimatedLoadingSector {...props} />}
      />
    );
  }

  const preparedData = data.map((item) => ({
    ...item,
    fill: `url(#${id}-colors-${item[nameKey] as string})`,
  }));

  return (
    <>
      <RechartsPie
        data={preparedData}
        dataKey={dataKey}
        nameKey={nameKey}
        innerRadius={innerRadius}
        outerRadius={OUTER_RADIUS}
        cornerRadius={cornerRadius}
        paddingAngle={paddingAngle}
        startAngle={START_ANGLE}
        endAngle={END_ANGLE}
        strokeWidth={0}
        isAnimationActive
        style={isClickable ? { cursor: "pointer" } : undefined}
        onClick={(_, index) => {
          if (!isClickable) return;
          const clickedName = data[index]?.[nameKey] as string;
          // Clicking the selected sector clears the selection, otherwise selects it
          selectSector(selectedSector === clickedName ? null : clickedName);
        }}
        shape={(props: PieSectorShapeProps) => {
          const sectorName = data[props.index ?? 0]?.[nameKey] as string;
          const isDimmed = isClickable && selectedSector !== null && selectedSector !== sectorName;

          return (
            <Sector
              {...props}
              fill={`url(#${id}-colors-${sectorName})`}
              stroke={paddingAngle < 0 ? "var(--background)" : "none"}
              strokeWidth={paddingAngle < 0 ? 5 : 0}
              opacity={isDimmed ? 0.15 : 1}
              className="transition-opacity duration-200"
            />
          );
        }}
      />
      <defs>
        <ColorGradients id={id} config={config} />
      </defs>
    </>
  );
}

/**
 * The hover tooltip. Hidden automatically while the chart is loading.
 */
function Tooltip() {
  const { isLoading, nameKey } = usePieChart();

  if (isLoading) return null;

  return <ChartTooltip content={<ChartTooltipContent nameKey={nameKey} />} />;
}

// ─────────────────────────────────────────────────────────────────────────────
// Style definitions — one set per <Pie />, scoped to its unique id
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Diagonal color gradients, one per sector. Each sector's fill paints from the
 * gradient that matches its name, supporting both single and multi-color config
 * entries.
 */
const ColorGradients = ({
  id,
  config,
}: {
  id: string; // unique id of the owning <Pie />
  config: ChartConfig; // sector colors the gradients are built from
}) => {
  return (
    <>
      {Object.entries(config).map(([sectorKey, sectorConfig]) => {
        const colorsCount = getColorsCount(sectorConfig);

        return (
          <linearGradient
            key={`${id}-colors-${sectorKey}`}
            id={`${id}-colors-${sectorKey}`}
            x1="0"
            y1="0"
            x2="1"
            y2="1"
          >
            {colorsCount === 1 ? (
              <>
                <stop offset="0%" stopColor={`var(--color-${sectorKey}-0)`} />
                <stop offset="100%" stopColor={`var(--color-${sectorKey}-0)`} />
              </>
            ) : (
              Array.from({ length: colorsCount }, (_, index) => {
                const offset = `${(index / (colorsCount - 1)) * 100}%`;
                return (
                  <stop
                    key={offset}
                    offset={offset}
                    stopColor={`var(--color-${sectorKey}-${index}, var(--color-${sectorKey}-0))`}
                  />
                );
              })
            )}
          </linearGradient>
        );
      })}
    </>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Loading skeleton
// ─────────────────────────────────────────────────────────────────────────────

// Equal-sized sectors used to render the circular pulsing loading skeleton
const LOADING_PIE_DATA = Array.from({ length: LOADING_SECTORS }, (_, i) => ({
  name: `loading${i}`,
  value: 100 / LOADING_SECTORS,
}));

/**
 * A single skeleton sector shown while the chart is loading. Each sector pulses
 * with a staggered delay, producing a wave that travels around the pie.
 */
const AnimatedLoadingSector = (props: ComponentProps<typeof Sector> & { index?: number }) => {
  const { index = 0, ...sectorProps } = props;

  // Staggered delay so the pulse sweeps around the circle
  const delay = (index / LOADING_SECTORS) * (LOADING_ANIMATION_DURATION / 1000);

  return (
    <motion.g
      initial={{ opacity: 0.15 }}
      animate={{ opacity: [0.15, 0.5, 0.15] }}
      transition={{
        duration: LOADING_ANIMATION_DURATION / 1000,
        delay,
        repeat: Infinity,
        ease: "easeInOut",
      }}
    >
      <Sector {...sectorProps} fill="currentColor" />
    </motion.g>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Static parts attached to the root
// ─────────────────────────────────────────────────────────────────────────────

EvilPieChart.Pie = Pie;
EvilPieChart.Tooltip = Tooltip;
