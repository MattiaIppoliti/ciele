import { svg as attentive } from "./attentive";
import { svg as curious } from "./curious";
import { svg as excited } from "./excited";
import { svg as happy } from "./happy";
import { svg as laughing } from "./laughing";
import { svg as neutral } from "./neutral";
import { svg as proud } from "./proud";
import { svg as sleepy } from "./sleepy";
import { svg as suspicious } from "./suspicious";

/* One animated cloud face per marketing page. Each module is a generated,
   self-contained animated SVG (baked CSS keyframes, blinks and eye drift)
   whose body/eye fills read `--bloub-body` / `--bloub-eyes`, and whose eyes
   sit in a `.bloub-gaze` group driven by `--bloub-gaze-x/y` (CloudAvatar). */
export const BLOUB_SVGS = {
  attentive,
  curious,
  excited,
  happy,
  laughing,
  neutral,
  proud,
  sleepy,
  suspicious,
} as const;

export type CloudExpression = keyof typeof BLOUB_SVGS;
