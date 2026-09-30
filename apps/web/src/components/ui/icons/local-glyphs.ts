import { Mailbox, Telescope, UsersRound, type LucideIcon } from "lucide-react";
import { MailboxIcon } from "./mailbox";
import { TelescopeIcon } from "./telescope";
import { UsersRoundIcon } from "./users-round";

/**
 * The lucide icons that have a motion-drawn twin in this tree rather than in
 * the animated-icon package, keyed by the lucide component the nav data names.
 * A row asks here first and falls back to `AnimatedIcon`, so adding a local
 * glyph is one line in this map instead of another `Icon === X ?` branch at
 * every call site.
 */
const LOCAL_GLYPHS = new Map<LucideIcon, typeof TelescopeIcon>([
  [Mailbox, MailboxIcon],
  [Telescope, TelescopeIcon],
  [UsersRound, UsersRoundIcon],
]);

export function localGlyphFor(icon: LucideIcon | undefined) {
  return icon ? (LOCAL_GLYPHS.get(icon) ?? null) : null;
}
