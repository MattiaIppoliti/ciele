# UI Arc chart sources

The fourteen component folders contain the free, open-source registry sources
from [UI Arc](https://uiarc.dev/llms.txt), retrieved on 2 October 2026.
Each source is available at `https://uiarc.dev/r/<folder-name>.json`; the matching
reference is `https://uiarc.dev/components/<folder-name>/markdown`.

The original component and CSS-module files are retained together. Motion-token
imports point to this folder's local token file. Spring bounce is disabled for
console motion. MetricCard forwards optional prefix and decimals to its animated
counter so sub-cent spend and rates retain their precision. Bar-chart averages
retain fractions rather than rounding to integers before the caller formats them.
Bar-chart axes scale to positive fractional values, with a fallback only for an empty or zero range.
Brush-chart tooltip comparisons and average captions follow the supplied day, week or month bucket.
Slope charts omit rank copy and table columns when ranks are disabled.
Gauge supports a compact ring for the Assistant Overview, with its exact rate alongside it.
Categorical chart marks use the shared grayscale `--chart-*` ramp in both themes.
Positive and negative outcomes retain green and red. Metric-card deltas and sparklines
use the metric's good direction (lower costs, latency and failures are positive). `theme.css` uses Ciele's colors, font, spacing and focus treatment
within `ArcFrame`, with dark selectors adapted to Ciele's `.dark` class, rather than installing Arc's global foundation reset.

Product adapters remain outside the vendor folders and preserve domain semantics,
units, loading states and data tables. Re-pulling a registry item requires checking
these local changes, keyboard behavior, reduced motion and both color themes.
