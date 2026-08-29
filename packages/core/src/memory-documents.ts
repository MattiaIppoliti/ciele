import type {
  MemoryDocument,
  MemoryDocumentEntry,
  MemoryDocumentOwner,
  MemoryDocumentScope,
  Project,
} from "./types";

/**
 * The three-layer document memory (#771), as pure rules.
 *
 * Three markdown documents reach a Teammate turn: the **User** layer (one per
 * Member, shared across every Teammate they talk to), the **Agent** layer (one
 * per Teammate, its distilled learnings) and the **Project** layer (one per
 * Project, the decisions the work already made). Each is injected whole.
 *
 * Whole, not retrieved, is the decision worth defending. The widget's `Memory`
 * is embedding recall, which suits "what do I half-remember about this
 * visitor". A colleague's profile and a team's conventions are not like that:
 * the top-k sentences of your own decisions is a worse input than none,
 * because the model cannot tell which of them it is missing. So these are
 * documents with a size cap, on the `answering_style` precedent.
 */

/**
 * The per-document injection cap.
 *
 * Three layers at 4k characters is roughly 3k tokens on every turn, before a
 * single search result. That is the number this is really trading: generous
 * enough that a real profile or a quarter of decisions fits, small enough that
 * three full layers plus retrieval still leave the model room to think. The
 * write path enforces the same cap, so what is stored is what is injected and
 * nobody has to wonder which half the model saw.
 */
export const MEMORY_DOCUMENT_MAX_CHARS = 4_000;

/** Which layer a stored row belongs to, from the one owner column it carries. */
export function memoryDocumentScope(
  row: Pick<MemoryDocument, "memberId" | "teammateId" | "projectId">
): MemoryDocumentScope {
  if (row.memberId) return "user";
  if (row.teammateId) return "agent";
  return "project";
}

/** The owner as the single argument reads and writes take. */
export function memoryDocumentOwner(
  row: Pick<MemoryDocument, "memberId" | "teammateId" | "projectId">
): MemoryDocumentOwner {
  if (row.memberId) return { scope: "user", memberId: row.memberId };
  if (row.teammateId) return { scope: "agent", teammateId: row.teammateId };
  return { scope: "project", projectId: row.projectId ?? "" };
}

/**
 * Trim a body to the cap, on a line boundary where one is near enough.
 *
 * Cutting mid-sentence hands the model half a decision, which is worse than
 * handing it one decision fewer: it reads the fragment as complete. So the cut
 * falls back to the last newline when that is within the final tenth of the
 * budget, and to a hard slice only when a single line is longer than the cap.
 */
export function capMemoryDocument(
  body: string,
  max = MEMORY_DOCUMENT_MAX_CHARS
): string {
  if (body.length <= max) return body;
  const head = body.slice(0, max);
  const lastBreak = head.lastIndexOf("\n");
  return lastBreak >= max - Math.floor(max / 10)
    ? head.slice(0, lastBreak)
    : head;
}

/** Whether an attached Project's decisions still reach the prompt. */
export function projectInjects(
  project: Pick<Project, "archived"> | null | undefined
): boolean {
  return Boolean(project) && !project!.archived;
}

/** The layers a turn actually has, before any of them is rendered. */
export interface MemoryLayerInput {
  /** The invoking Member's own profile document. */
  user?: string | null;
  /** This Teammate's distilled learnings. */
  agent?: string | null;
  /** The attached Project's decisions, already filtered by {@link projectInjects}. */
  project?: string | null;
  /** Shown in the Project heading so the model can name what it is citing. */
  projectName?: string | null;
}

/**
 * The memory layers as prompt sections, or `[]` when a turn has none.
 *
 * Empty layers inject nothing at all, not an empty heading: a section that says
 * "# What I have learned" followed by nothing invites the model to explain that
 * it has learned nothing, and spends tokens saying so. This is the same reason
 * a scopeless Teammate gets no search tool rather than one that returns
 * nothing (#768).
 *
 * Each heading states who the layer is *about* and who may change it, because
 * the model treats the three very differently: the User layer is a fact about
 * the person it is talking to, the Agent layer is its own accumulated opinion,
 * and the Project layer is the team's settled decisions and outranks both.
 */
export function memoryPromptSections(input: MemoryLayerInput): string[] {
  const sections: string[] = [];
  const user = capMemoryDocument((input.user ?? "").trim());
  const agent = capMemoryDocument((input.agent ?? "").trim());
  const project = capMemoryDocument((input.project ?? "").trim());

  if (user) {
    sections.push(
      [
        "# About the colleague you are talking to",
        "Their own profile document. They wrote it or approved it, so treat it as true and never contradict it back to them.",
        user,
      ].join("\n")
    );
  }
  if (agent) {
    sections.push(
      [
        "# What you have learned in this role",
        "Your own accumulated notes from earlier conversations. Useful, and weaker than anything below: a decision or a source beats a note you made to yourself.",
        agent,
      ].join("\n")
    );
  }
  if (project) {
    const name = (input.projectName ?? "").trim();
    sections.push(
      [
        name
          ? `# Decisions already made on ${name}`
          : "# Decisions already made on this project",
        "The team's settled conventions and decisions. When a question is about what was decided, answer from here, and say plainly when the document does not cover it.",
        project,
      ].join("\n")
    );
  }
  return sections;
}

/**
 * Append one distilled learning to the Agent layer.
 *
 * Append rather than rewrite, and dated, because the layer is a log of what
 * the Teammate worked out, not a summary somebody has to keep re-approving. It
 * caps from the *front*, so the oldest learnings fall off first: a note from
 * March that no longer holds is exactly the one to lose.
 */
export function appendAgentLearning(
  body: string,
  learning: string,
  at: string,
  max = MEMORY_DOCUMENT_MAX_CHARS
): string {
  const line = `- ${at.slice(0, 10)}: ${learning.trim()}`;
  const next = body.trim() ? `${body.trim()}\n${line}` : line;
  if (next.length <= max) return next;
  // Drop whole leading lines until it fits. A learning is one line, so this
  // never leaves half of one behind.
  const lines = next.split("\n");
  while (lines.length > 1 && lines.join("\n").length > max) lines.shift();
  return lines.join("\n").slice(-max);
}

/**
 * One entry paired with the text it changed, so history can say *what* and not
 * only who and when (#767, story 19).
 *
 * An entry stores the body as it was before the write, which is what makes a
 * revert possible. The text after a write is therefore not in the row: it is
 * the *next* entry's `bodyBefore`, or for the most recent entry the document as
 * it now reads. Chaining that here rather than in the component keeps the
 * off-by-one in one tested place.
 */
export interface MemoryDocumentChange {
  entry: MemoryDocumentEntry;
  before: string;
  after: string;
  /** Net character change, for a history row that has one line to say it in. */
  delta: number;
}

/**
 * The history of a document as changes, newest first.
 *
 * `entries` must be newest-first, which is the order both `Db` implementations
 * return. `currentBody` is what the document says now; with no entries there is
 * nothing to compare and the list is empty.
 */
export function memoryDocumentChanges(
  entries: readonly MemoryDocumentEntry[],
  currentBody: string
): MemoryDocumentChange[] {
  return entries.map((entry, index) => {
    const previous = entries[index - 1];
    const after = previous ? previous.bodyBefore : currentBody;
    return {
      entry,
      before: entry.bodyBefore,
      after,
      delta: after.length - entry.bodyBefore.length,
    };
  });
}
