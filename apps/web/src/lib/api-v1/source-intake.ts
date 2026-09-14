import { extractSourceText } from "@agent-hub/agent";
import type { TriageEvidence } from "@agent-hub/core";
import { isSupabaseConfigured } from "@agent-hub/db";
import { apiError } from "@/lib/api-v1/http";
import { requireApiCapability, resolveApiKeyContext } from "@/lib/api-v1/auth";
import { checkUploadAllowance, uploadThrottledMessage } from "@/lib/upload-limit";
import {
  uploadKnowledgeOriginal,
  validateKnowledgeFile,
} from "@/lib/storage/assets";
import {
  createSupabaseServiceClient,
  isSupabaseServiceConfigured,
} from "@/lib/supabase/service";

/**
 * Everything a knowledge-add route does before an operation sees it: authorize,
 * spend the upload budget, parse JSON or multipart, extract the text, store the
 * original binary.
 *
 * It lives here because two routes do it. `POST /collections/{id}/sources`
 * names the Collection; `POST /knowledge/sources` lets `addOrgSourceOp` resolve
 * the org Knowledge Library, which is the only add path a caller holding
 * nothing but an Assistant id can use. The surface work is identical, and a
 * copy of it is how one door ends up without the triage stamp or the budget.
 */

export interface IntakenSource {
  name: string;
  kind: "text" | "url" | "file";
  rawText: string;
  sourceUrl?: string;
  originalObjectPath?: string;
  triage?: TriageEvidence;
  /** PRD #726 links, parsed from JSON or the multipart field. */
  assistantIds?: string[];
}

/**
 * Authorization happens BEFORE any side effect. Extraction fetches a
 * caller-supplied URL and the multipart branch writes an object to storage; both
 * used to run ahead of the operation, which is where the `edit` check lives, so
 * a key of any role could make the server fetch a URL and read back the status.
 */
export async function intakeSource(
  request: Request
): Promise<Response | IntakenSource> {
  const auth = await resolveApiKeyContext(request);
  if (auth instanceof Response) return auth;
  const forbidden = requireApiCapability(auth, "edit");
  if (forbidden) return forbidden;

  // The same per-member budget as the console doors (#801, CYB-01), keyed on
  // the human the key delegates for, so a scripted key and a scripted Server
  // Action draw on one window. Only the two kinds that run a parser or a fetch
  // are budgeted: a text Source costs nothing to accept.
  const budget = (): Response | null => {
    const decision = checkUploadAllowance(auth.organizationId, auth.actorUserId);
    return decision.allowed ? null : rateLimited(decision.retryAfterMs);
  };

  const contentType = request.headers.get("content-type") ?? "";
  try {
    if (contentType.includes("multipart/form-data")) {
      const form = await request.formData();
      let assistantIds: string[] | undefined;
      const rawIds = form.get("assistantIds");
      if (typeof rawIds === "string" && rawIds) {
        const parsed: unknown = JSON.parse(rawIds);
        if (Array.isArray(parsed)) assistantIds = parsed.map((id) => String(id));
      }
      const file = form.get("file");
      if (!(file instanceof File) || file.size === 0) {
        return apiError(400, "invalid_input", "Provide a non-empty 'file' field");
      }
      const validation = validateKnowledgeFile({
        name: file.name,
        size: file.size,
      });
      if (!validation.ok) return apiError(400, "invalid_input", validation.error);
      const throttled = budget();
      if (throttled) return throttled;

      const extracted = await extractSourceText({
        kind: "file",
        name: file.name,
        bytes: await file.arrayBuffer(),
      });
      let originalObjectPath: string | undefined;
      if (isSupabaseConfigured() && isSupabaseServiceConfigured()) {
        const stored = await uploadKnowledgeOriginal(
          createSupabaseServiceClient(),
          { organizationId: auth.organizationId, file }
        );
        originalObjectPath = stored.path;
      }
      return {
        name: extracted.name,
        kind: "file",
        rawText: extracted.text,
        originalObjectPath,
        // The console doors persist this; a file that arrives through a key
        // must carry the same verdict, or a rule bump cannot name which
        // Sources predate it (#801, CYB-09).
        triage: extracted.triage,
        assistantIds,
      };
    }

    const body = await request.json().catch(() => null);
    if (body === null) return apiError(400, "invalid_input", "Body must be JSON");
    const assistantIds = Array.isArray(body.assistantIds)
      ? (body.assistantIds as unknown[]).map((id) => String(id))
      : undefined;
    if (body.kind === "url" && typeof body.url === "string") {
      const throttled = budget();
      if (throttled) return throttled;
      const extracted = await extractSourceText({ kind: "url", url: body.url });
      return {
        name: extracted.name,
        kind: "url",
        rawText: extracted.text,
        sourceUrl: body.url,
        assistantIds,
      };
    }
    if (body.kind === "text" && typeof body.text === "string") {
      const extracted = await extractSourceText({
        kind: "text",
        name: String(body.name ?? "Untitled"),
        text: body.text,
      });
      return {
        name: extracted.name,
        kind: "text",
        rawText: extracted.text,
        assistantIds,
      };
    }
    return apiError(
      400,
      "invalid_input",
      'kind must be "text" (with text) or "url" (with url); files go via multipart'
    );
  } catch (error) {
    // Extraction failures (bad PDF, unreachable URL, no extractable text) are
    // the caller's input problem, reported plainly like the web action.
    return apiError(
      400,
      "invalid_input",
      error instanceof Error ? error.message : "Extraction failed"
    );
  }
}

/** The 429 the console doors express as a form error; here a status and a header. */
function rateLimited(retryAfterMs: number): Response {
  const response = apiError(429, "rate_limited", uploadThrottledMessage(retryAfterMs));
  response.headers.set(
    "retry-after",
    String(Math.max(1, Math.ceil(retryAfterMs / 1000)))
  );
  return response;
}
