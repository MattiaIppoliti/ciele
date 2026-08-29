import { unstable_cache, updateTag } from "next/cache";
import { isSupabaseConfigured } from "@agent-hub/db";
import { DEFAULT_PLATFORM_PROMPT } from "@agent-hub/agent";
import { getWidgetDb } from "./widget-db";

/**
 * The platform (Ciele) system-prompt layer, the app's half.
 *
 * Two-layer prompt model (see docs/agentic-chat-runtime.md):
 * - The PLATFORM prompt is owned by Ciele itself. Organizations and their
 *   assistants can never read or change it; it is stored in
 *   `platform_settings` (RLS: service-role only) and edited exclusively by
 *   the platform owner (PLATFORM_OWNER_EMAIL) from Settings → AI.
 * - Each assistant's `answeringStyle` is the org-authored layer underneath:
 *   persona, tone, format. The runtime composes platform → assistant → flow
 *   in that precedence order (`@agent-hub/agent`'s `actions.ts`).
 *
 * The shipped default text lives in `@agent-hub/agent` (`host.ts`) because the
 * runtime must have a usable prompt with no host wired. What lives here is the
 * part only the app can do: the tagged, cached, service-role read of the stored
 * override, registered as the runtime's `getPlatformSystemPrompt` port in
 * `instrumentation.ts`.
 */

const PLATFORM_PROMPT_TAG = "platform-system-prompt";

/**
 * Data access goes through the Db facade: `getWidgetDb()` is the app's
 * service-role-backed Db (falling back to the anon key, and to the in-memory
 * mock when Supabase env is absent, which keeps the owner flow fully working
 * in demo mode, the mock store holding the prompt).
 */
function platformDb() {
  return getWidgetDb();
}

/**
 * Only the platform owner may see or edit the platform prompt. Configured
 * via PLATFORM_OWNER_EMAIL (comma-separated list allowed); in demo mode
 * (no Supabase) everyone is the owner so the surface stays explorable.
 */
export function isPlatformOwner(email: string | null | undefined): boolean {
  if (!isSupabaseConfigured()) return true;
  const owners = (process.env.PLATFORM_OWNER_EMAIL ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  if (owners.length === 0) return false;
  return owners.includes((email ?? "").trim().toLowerCase());
}

/**
 * The effective platform prompt for a chat turn: the stored override when the
 * owner has set one, otherwise the shipped default. Read with the service
 * role, org-scoped clients cannot see the row at all.
 */
export async function getPlatformSystemPrompt(): Promise<string> {
  if (!isSupabaseConfigured()) {
    // Demo/mock mode bypasses the cache: deterministic in-memory reads.
    return readPlatformSystemPrompt();
  }
  return unstable_cache(
    async () => readPlatformSystemPrompt(),
    ["platform-system-prompt"],
    { revalidate: 60 * 60 * 24, tags: [PLATFORM_PROMPT_TAG] }
  )();
}

async function readPlatformSystemPrompt(): Promise<string> {
  try {
    const stored = (await platformDb().getPlatformSystemPromptOverride()).trim();
    return stored || DEFAULT_PLATFORM_PROMPT;
  } catch {
    return DEFAULT_PLATFORM_PROMPT;
  }
}

/** The stored override (may be empty = "use the shipped default"). Owner-only surface. */
export async function getStoredPlatformPrompt(): Promise<string> {
  return platformDb().getPlatformSystemPromptOverride();
}

/** Persist the override. Callers MUST have checked isPlatformOwner first. */
export async function setPlatformSystemPrompt(
  prompt: string,
  updatedBy: string
): Promise<void> {
  await platformDb().setPlatformSystemPrompt(prompt, updatedBy);
  // No tagged cache to invalidate in demo mode (and updateTag is
  // server-action-only next to a real deployment anyway).
  if (isSupabaseConfigured()) updateTag(PLATFORM_PROMPT_TAG);
}
