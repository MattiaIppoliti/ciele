import { z } from "zod";
import type {
  MemoryDocument,
  MemoryDocumentEntry,
  Project,
  ProjectPatch,
} from "@agent-hub/core";
import { MEMORY_DOCUMENT_MAX_CHARS } from "@agent-hub/core";
import { OperationError, defineOperation, type OperationContext } from "./operation";
import {
  requireEditableTeammate,
  requireReadableTeammate,
  requireTeammate,
} from "./teammate-access";

/**
 * Memory documents and Projects (#771).
 *
 * Three layers, three different answers to "who may change this", and the
 * differences are the whole design:
 *
 * - **User**: the Member's own, and only theirs. Every operation here derives
 *   the member id from the context and takes none as input, so there is no
 *   shape of call that reads or writes somebody else's profile. Story 19 makes
 *   the Member sovereign; a `memberId` parameter would make that a promise
 *   rather than a property.
 * - **Agent**: the Teammate's, governed by whoever may edit the Teammate.
 * - **Project**: the team's, governed at Editor and up like the Project itself.
 *
 * The two *tool* writes a Teammate performs mid-turn live at the bottom. They
 * are deliberately not grant-gated (#770's rows govern acting on the console's
 * domains; remembering is what makes a colleague a colleague), and they are
 * deliberately parameterless about whose document they touch.
 */

const bodySchema = z.string().max(MEMORY_DOCUMENT_MAX_CHARS * 2);
const noteSchema = z.string().max(300).default("");

export const projectPatchSchema = z
  .object({
    name: z.string().min(1).max(120),
    description: z.string().max(2000),
    archived: z.boolean(),
  })
  .partial() satisfies z.ZodType<ProjectPatch, ProjectPatch>;

async function requireProject(
  ctx: OperationContext,
  id: string
): Promise<Project> {
  const project = await ctx.db.table("projects").get(id);
  if (!project || project.organizationId !== ctx.organizationId) {
    throw new OperationError("not_found", "Project not found");
  }
  return project;
}

/** A document plus its history: what every read surface renders. */
export interface MemoryDocumentView {
  document: MemoryDocument | null;
  entries: MemoryDocumentEntry[];
}

async function readWithHistory(
  ctx: OperationContext,
  document: MemoryDocument | null
): Promise<MemoryDocumentView> {
  if (!document) return { document: null, entries: [] };
  return {
    document,
    entries: await ctx.db.listMemoryDocumentEntries(document.id),
  };
}

// ── Projects ────────────────────────────────────────────────────────────────

export const listProjectsOp = defineOperation({
  name: "projects.list",
  capability: "member",
  input: z.object({}),
  entities: () => [],
  run: (ctx): Promise<Project[]> =>
    ctx.db.table("projects").list({ organizationId: ctx.organizationId }),
});

export const getProjectOp = defineOperation({
  name: "projects.get",
  capability: "member",
  input: z.object({ id: z.string().min(1) }),
  entities: () => [],
  run: async (
    ctx,
    { id }
  ): Promise<{ project: Project } & MemoryDocumentView> => {
    const project = await requireProject(ctx, id);
    const document = await ctx.db.getMemoryDocument(ctx.organizationId, {
      scope: "project",
      projectId: id,
    });
    return { project, ...(await readWithHistory(ctx, document)) };
  },
});

export const createProjectOp = defineOperation({
  name: "projects.create",
  capability: "edit",
  input: z.object({
    name: z.string().min(1).max(120),
    description: z.string().max(2000).default(""),
  }),
  entities: () => [{ kind: "projectList" as const }],
  run: (ctx, input): Promise<Project> =>
    ctx.db.table("projects").insert({
      organizationId: ctx.organizationId,
      name: input.name,
      description: input.description,
      createdBy: ctx.userId || null,
    }),
});

export const updateProjectOp = defineOperation({
  name: "projects.update",
  capability: "edit",
  input: z.object({ id: z.string().min(1), patch: projectPatchSchema }),
  entities: ({ id }) => [
    { kind: "project" as const, id },
    { kind: "projectList" as const },
  ],
  run: async (ctx, { id, patch }): Promise<Project> => {
    await requireProject(ctx, id);
    return ctx.db.table("projects").update(id, patch);
  },
});

export const deleteProjectOp = defineOperation({
  name: "projects.delete",
  capability: "edit",
  input: z.object({ id: z.string().min(1) }),
  entities: ({ id }) => [
    { kind: "project" as const, id },
    { kind: "projectList" as const },
    // Every attached Teammate loses its Project layer next turn.
    { kind: "teammateList" as const },
  ],
  run: async (ctx, { id }): Promise<void> => {
    await requireProject(ctx, id);
    // The decisions go with it (FK cascade) and attached Teammates detach
    // (`set null`), which is why deleting is offered at all: archiving is the
    // move that keeps the record.
    await ctx.db.table("projects").delete(id);
  },
});

export const writeProjectDocumentOp = defineOperation({
  name: "projects.document.write",
  capability: "edit",
  input: z.object({
    id: z.string().min(1),
    body: bodySchema,
    note: noteSchema,
  }),
  entities: ({ id }) => [{ kind: "project" as const, id }],
  run: async (ctx, input): Promise<MemoryDocument> => {
    await requireProject(ctx, input.id);
    return ctx.db.writeMemoryDocument({
      organizationId: ctx.organizationId,
      owner: { scope: "project", projectId: input.id },
      body: input.body,
      note: input.note,
      teammateId: ctx.teammate?.id ?? null,
      authorId: ctx.userId || null,
    });
  },
});

// ── The User layer ──────────────────────────────────────────────────────────

export const getMyMemoryOp = defineOperation({
  name: "memory.me.get",
  capability: "member",
  input: z.object({}),
  entities: () => [],
  run: async (ctx): Promise<MemoryDocumentView> => {
    // No member id in, no member id out. The only document this operation can
    // name is the caller's.
    const document = await ctx.db.getMemoryDocument(ctx.organizationId, {
      scope: "user",
      memberId: ctx.userId,
    });
    return readWithHistory(ctx, document);
  },
});

export const writeMyMemoryOp = defineOperation({
  name: "memory.me.write",
  capability: "member",
  input: z.object({ body: bodySchema, note: noteSchema }),
  entities: () => [{ kind: "myMemory" as const }],
  run: async (ctx, input): Promise<MemoryDocument> =>
    ctx.db.writeMemoryDocument({
      organizationId: ctx.organizationId,
      owner: { scope: "user", memberId: ctx.userId },
      body: input.body,
      note: input.note || "Edited in settings",
      authorId: ctx.userId || null,
    }),
});

export const revertMyMemoryOp = defineOperation({
  name: "memory.me.revert",
  capability: "member",
  input: z.object({ entryId: z.string().min(1) }),
  entities: () => [{ kind: "myMemory" as const }],
  run: async (ctx, { entryId }): Promise<MemoryDocument> => {
    // Reverting reaches a document by an entry id, so the guard has to run the
    // other way: resolve the entry's document and refuse unless it is the
    // caller's own. Without this, a well-formed entry id from anywhere would
    // rewrite somebody else's profile.
    const own = await ctx.db.getMemoryDocument(ctx.organizationId, {
      scope: "user",
      memberId: ctx.userId,
    });
    const entries = own ? await ctx.db.listMemoryDocumentEntries(own.id) : [];
    if (!entries.some((entry) => entry.id === entryId)) {
      throw new OperationError("not_found", "No such entry in your memory");
    }
    return ctx.db.revertMemoryDocument({ entryId, authorId: ctx.userId || null });
  },
});

// ── The Agent layer ─────────────────────────────────────────────────────────

export const getTeammateMemoryOp = defineOperation({
  name: "teammates.memory.get",
  capability: "member",
  input: z.object({ id: z.string().min(1) }),
  entities: () => [],
  run: async (ctx, { id }): Promise<MemoryDocumentView> => {
    await requireReadableTeammate(ctx, id);
    const document = await ctx.db.getMemoryDocument(ctx.organizationId, {
      scope: "agent",
      teammateId: id,
    });
    return readWithHistory(ctx, document);
  },
});

export const writeTeammateMemoryOp = defineOperation({
  name: "teammates.memory.write",
  capability: "edit",
  input: z.object({
    id: z.string().min(1),
    body: bodySchema,
    note: noteSchema,
  }),
  entities: ({ id }) => [{ kind: "teammate" as const, id }],
  run: async (ctx, input): Promise<MemoryDocument> => {
    // The same ownership rule that governs the persona: a wrong learning is
    // corrected by whoever maintains the Teammate (#767, story 21). A Teammate
    // appending its own learning is the one caller that skips it, because it is
    // writing its own document and holds no Member's Role to check.
    if (ctx.teammate) {
      await requireTeammate(ctx, input.id);
    } else {
      await requireEditableTeammate(ctx, input.id);
    }
    return ctx.db.writeMemoryDocument({
      organizationId: ctx.organizationId,
      owner: { scope: "agent", teammateId: input.id },
      body: input.body,
      note: input.note || "Edited by hand",
      teammateId: ctx.teammate?.id ?? null,
      authorId: ctx.userId || null,
    });
  },
});

// ── What a Teammate writes mid-turn ─────────────────────────────────────────

function requireActingTeammate(ctx: OperationContext) {
  if (!ctx.teammate) {
    throw new OperationError(
      "invalid_input",
      "This operation is a Teammate's own tool"
    );
  }
  return ctx.teammate;
}

export const rememberAboutMemberOp = defineOperation({
  name: "memory.remember",
  capability: "member",
  input: z.object({
    /** The whole document as it should now read, not a fragment to append. */
    body: bodySchema,
    note: z.string().max(300),
  }),
  entities: () => [{ kind: "myMemory" as const }],
  run: async (ctx, input): Promise<MemoryDocument> => {
    const teammate = requireActingTeammate(ctx);
    // Whose profile: the Member on the other end of this turn, always. The
    // operation takes no member id, so no prompt injection and no model
    // mistake can point it at a colleague.
    return ctx.db.writeMemoryDocument({
      organizationId: ctx.organizationId,
      owner: { scope: "user", memberId: ctx.userId },
      body: input.body,
      note: input.note,
      teammateId: teammate.id,
      authorId: ctx.userId || null,
    });
  },
});

export const recordProjectDecisionOp = defineOperation({
  name: "memory.project.record",
  capability: "member",
  input: z.object({ body: bodySchema, note: z.string().max(300) }),
  entities: () => [{ kind: "projectList" as const }],
  run: async (ctx, input): Promise<MemoryDocument> => {
    const teammate = requireActingTeammate(ctx);
    // Which Project: the one this Teammate is attached to. Same reasoning as
    // above, the model never names the target.
    if (!teammate.projectId) {
      throw new OperationError(
        "invalid_input",
        "You are not attached to a project, so there is nowhere to record this. Tell the person to attach you to one first."
      );
    }
    const project = await requireProject(ctx, teammate.projectId);
    if (project.archived) {
      throw new OperationError(
        "invalid_input",
        `${project.name} is archived, so its decisions are read-only.`
      );
    }
    return ctx.db.writeMemoryDocument({
      organizationId: ctx.organizationId,
      owner: { scope: "project", projectId: project.id },
      body: input.body,
      note: input.note,
      teammateId: teammate.id,
      authorId: ctx.userId || null,
    });
  },
});
