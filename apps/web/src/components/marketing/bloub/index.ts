/* One animated cloud face per marketing page. Each expression is a generated,
   self-contained animated SVG (baked CSS keyframes, blinks and eye drift)
   whose body/eye fills read `--bloub-body` / `--bloub-eyes`, and whose eyes
   sit in a `.bloub-gaze` group driven by `--bloub-gaze-x/y` (CloudAvatar).

   The markup lives in `public/bloub/<expression>.svg` rather than in a module,
   and that is a document-size decision, not tidiness. Each face is ~17 kB: as
   a prop handed to CloudAvatar it was serialized into the RSC payload of every
   marketing page *and* rendered into the HTML on top of that, ~67 kB per
   document for a decorative mascot that is `aria-hidden`. As a file the
   browser fetches one face once and reuses it across every navigation. Holding
   the names in a list rather than deriving them from an import map is what
   keeps the strings out of the build graph; `bloub.test.ts` is what keeps the
   list and the files from drifting apart. */
export const CLOUD_EXPRESSIONS = [
  "attentive",
  "curious",
  "excited",
  "happy",
  "laughing",
  "neutral",
  "proud",
  "sleepy",
  "suspicious",
] as const;

export type CloudExpression = (typeof CLOUD_EXPRESSIONS)[number];

/** Where CloudAvatar fetches one face from. Root-relative, so it resolves on
 *  whichever origin serves the marketing site. */
export function bloubSvgUrl(expression: CloudExpression): string {
  return `/bloub/${expression}.svg`;
}
