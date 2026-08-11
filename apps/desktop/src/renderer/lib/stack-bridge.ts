import { bridge } from "./bridge";
import type { StackBridge } from "../../shared/stack";

/** The local-stack half of the bridge. Same object, narrower view. */
export function stackBridge(): StackBridge["stack"] {
  return bridge().stack;
}
