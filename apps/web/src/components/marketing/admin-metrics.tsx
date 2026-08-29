/* The admin-dashboard visual: three metric traces scrolling right to left in a
   loop, with query chips pinned over them. The waveform is generated from a sum
   of sines rather than random noise, so it is identical on the server and the
   client (no hydration mismatch) and, being periodic over the interval, its
   end meets its start exactly, which is what makes the loop seamless. */

const WIDTH = 600;
const HEIGHT = 90;
const STEPS = 180;

interface Wave {
  /** [amplitude, frequency (whole cycles across the loop), phase] per harmonic. */
  harmonics: [number, number, number][];
  className: string;
  duration: string;
}

const WAVES: Wave[] = [
  {
    harmonics: [
      [1, 3, 0],
      [0.55, 7, 1.1],
      [0.3, 13, 2.4],
      [0.16, 23, 0.6],
    ],
    className: "text-sky-500 dark:text-sky-400",
    duration: "34s",
  },
  {
    harmonics: [
      [0.9, 4, 2.2],
      [0.5, 9, 0.4],
      [0.28, 17, 1.7],
      [0.14, 29, 2.9],
    ],
    className: "text-emerald-500 dark:text-emerald-400",
    duration: "26s",
  },
  {
    harmonics: [
      [0.8, 2, 1.4],
      [0.42, 6, 2.7],
      [0.24, 11, 0.9],
      [0.12, 19, 1.9],
    ],
    className: "text-rose-500 dark:text-rose-400",
    duration: "42s",
  },
];

/** One loop's worth of points, as an SVG polyline `points` string. */
function trace({ harmonics }: Wave, offsetX: number) {
  const peak = harmonics.reduce((sum, [amplitude]) => sum + amplitude, 0);
  const points: string[] = [];
  for (let step = 0; step <= STEPS; step += 1) {
    const t = step / STEPS;
    const value = harmonics.reduce(
      (sum, [amplitude, frequency, phase]) =>
        sum + amplitude * Math.sin(2 * Math.PI * frequency * t + phase),
      0
    );
    const x = offsetX + t * WIDTH;
    // Map [-peak, peak] into the band, leaving a little headroom top and bottom.
    const y = HEIGHT / 2 - (value / peak) * (HEIGHT / 2 - 6);
    points.push(`${x.toFixed(1)},${y.toFixed(1)}`);
  }
  return points.join(" ");
}

function Chip({
  keyword,
  value,
  className,
}: {
  keyword: string;
  value?: string;
  className: string;
}) {
  return (
    <span
      className={`border-border bg-background/85 text-muted-foreground absolute flex items-center overflow-hidden rounded-md border font-mono text-[0.65rem] backdrop-blur-sm ${className}`}
    >
      <span className="px-1.5 py-1">{keyword}</span>
      {value && (
        <span className="border-border text-foreground border-l px-1.5 py-1">{value}</span>
      )}
    </span>
  );
}

export function AdminMetrics() {
  return (
    <div className="border-border bg-background/40 relative overflow-hidden rounded-2xl border py-6">
      <div className="space-y-2">
        {WAVES.map((wave) => (
          <svg
            key={wave.className}
            aria-hidden
            className={`block h-20 w-full ${wave.className}`}
            viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
            preserveAspectRatio="none"
            fill="none"
          >
            {/* Two copies side by side; the group slides one copy's width. */}
            <g
              className="home-metric-scroll"
              style={{ "--metric-duration": wave.duration } as React.CSSProperties}
            >
              <polyline
                points={trace(wave, 0)}
                stroke="currentColor"
                strokeWidth="1.5"
                vectorEffect="non-scaling-stroke"
              />
              <polyline
                points={trace(wave, WIDTH)}
                stroke="currentColor"
                strokeWidth="1.5"
                vectorEffect="non-scaling-stroke"
              />
            </g>
          </svg>
        ))}
      </div>

      {/* The query the traces are answering, pinned over them. */}
      <Chip keyword="MAX" className="left-[12%] top-3" />
      <Chip keyword="SUM" className="right-[26%] top-[18%]" />
      <Chip keyword="VISUALIZE" value="conversations" className="right-[3%] top-[30%]" />
      <Chip keyword="WHERE" value="channel='widget'" className="left-[4%] top-[45%]" />
      <Chip keyword="AVG" value="resolution_rate" className="right-[18%] top-[56%]" />
      <Chip keyword="GROUP BY" value="assistant" className="left-[20%] bottom-[16%]" />
      <Chip keyword="WHERE" value="rating='down'" className="bottom-3 right-[6%]" />
    </div>
  );
}
