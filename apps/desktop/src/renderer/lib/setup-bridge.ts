import { bridge } from "./bridge";
import type { SetupBridge } from "../../shared/setup-ipc";

/** The wizard half of the bridge. Same object, narrower view. */
export function setupBridge(): SetupBridge["setup"] {
  return bridge().setup;
}
