import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createSchemaLoadedPglite } from "./supabase-contract-harness";

/**
 * Who may see and change the work (#1047), against the shipping migration.
 *
 * The operations layer (`canReadProject` / `canWriteProject` in core) is the
 * readable half of these rules; PostgREST is a way around it, because a request
 * carrying a Member's own JWT reaches the tables directly. So the visibility of
 * a private Project and everything in it, the Viewer's comment-only rung, the
 * own-row notification rule and the Organization line are asserted here, as
 * `authenticated` with the caller's id in the JWT claim rather than as the
 * superuser PGlite otherwise hands us (the channel-access.test.ts pattern).
 */

let pg: PGlite;
let orgId: string;
let foreignOrgId: string;
/** Created the private Project and sits on it, as #1047 seats a creator; an Editor. */
let creator: string;
/** Seated on the private Project, Viewer role. */
let seatedViewer: string;
/** Editor in the Organization, not seated on the private Project. */
let outsider: string;
/** Admin, never seated: sees private Projects by rule. */
let admin: string;
/** Member of another Organization. */
let stranger: string;

async function seedUser(email: string, org: string, role: string): Promise<string> {
  const id = randomUUID();
  await pg.query(`insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, '{}')`, [id, email]);
  await pg.query(
    `insert into public.organization_members (organization_id, user_id, role)
     values ($1, $2, $3)
     on conflict (organization_id, user_id) do update set role = excluded.role`,
    [org, id, role]
  );
  return id;
}

/** Run one statement the way PostgREST does: as `authenticated`, as this user. */
async function actingAs(userId: string, sql: string, params: unknown[] = []): Promise<{ rows: unknown[] }> {
  await pg.query(`select set_config('request.jwt.claim.sub', $1, false)`, [userId]);
  await pg.exec("set role authenticated");
  try {
    return (await pg.query(sql, params)) as { rows: unknown[] };
  } finally {
    await pg.exec("reset role");
  }
}

async function visibleIds(userId: string, table: string): Promise<string[]> {
  const { rows } = await actingAs(userId, `select id from public.${table} order by id`);
  return (rows as { id: string }[]).map((row) => row.id);
}

beforeAll(async () => {
  pg = await createSchemaLoadedPglite();
  orgId = randomUUID();
  foreignOrgId = randomUUID();
  await pg.query(`insert into public.organizations (id, name) values ($1, 'Work U'), ($2, 'Elsewhere')`, [
    orgId,
    foreignOrgId,
  ]);
  creator = await seedUser("creator@work-test.edu", orgId, "editor");
  seatedViewer = await seedUser("viewer@work-test.edu", orgId, "viewer");
  outsider = await seedUser("outsider@work-test.edu", orgId, "editor");
  admin = await seedUser("admin@work-test.edu", orgId, "admin");
  stranger = await seedUser("stranger@work-test.edu", foreignOrgId, "owner");

  await pg.exec(`
    grant usage on schema public to authenticated;
    grant usage on schema private to authenticated;
    grant select, insert, update, delete on all tables in schema public to authenticated;
    grant execute on all functions in schema public to authenticated;
  `);

  await pg.query(
    `insert into public.projects (id, organization_id, name, key, visibility, created_by)
     values ('pr-open', $1, 'Open', 'OPN', 'organization', $2),
            ('pr-secret', $1, 'Secret', 'SEC', 'private', $2),
            ('pr-foreign', $3, 'Foreign', 'FOR', 'organization', $4)`,
    [orgId, creator, foreignOrgId, stranger]
  );
  await pg.query(
    `insert into public.project_members (id, organization_id, project_id, user_id)
     values ('pm-viewer', $1, 'pr-secret', $2), ('pm-creator', $1, 'pr-secret', $3)`,
    [orgId, seatedViewer, creator]
  );
  // Two more private Projects for the creator rule: one nobody is seated on
  // yet, and one whose creator was removed in Share.
  await pg.query(
    `insert into public.projects (id, organization_id, name, key, visibility, created_by)
     values ('pr-draft', $1, 'Draft', 'DRF', 'private', $2),
            ('pr-left', $1, 'Left', 'LFT', 'private', $3)`,
    [orgId, outsider, creator]
  );
  await pg.query(
    `insert into public.project_members (id, organization_id, project_id, user_id)
     values ('pm-left', $1, 'pr-left', $2)`,
    [orgId, seatedViewer]
  );
  await pg.query(
    `insert into public.tasks (id, organization_id, project_id, seq, title, rank)
     values ('t-open', $1, 'pr-open', 1, 'Open task', 'V'),
            ('t-secret', $1, 'pr-secret', 1, 'Secret task', 'V'),
            ('t-foreign', $2, 'pr-foreign', 1, 'Foreign task', 'V')`,
    [orgId, foreignOrgId]
  );
  await pg.query(
    `insert into public.task_comments (id, organization_id, project_id, task_id, author_member_id, body)
     values ('c-secret', $1, 'pr-secret', 't-secret', $2, 'Hush')`,
    [orgId, creator]
  );
  await pg.query(
    `insert into public.member_notifications (id, organization_id, recipient_id, kind, project_id, task_id)
     values ('n-viewer', $1, $2, 'assigned', 'pr-secret', 't-secret')`,
    [orgId, seatedViewer]
  );
  await pg.query(
    `insert into public.project_files (id, organization_id, project_id, task_id, name, storage_path, size_bytes, uploaded_by)
     values ('f-secret', $1, 'pr-secret', 't-secret', 'plan.pdf', $3, 10, $2)`,
    [orgId, creator, `org/${orgId}/projects/pr-secret/f-secret/plan.pdf`]
  );
  await pg.query(
    `insert into public.task_labels (id, organization_id, name) values ('l-ours', $1, 'Bug'), ('l-theirs', $2, 'Bug')`,
    [orgId, foreignOrgId]
  );
  await pg.query(
    `insert into public.tasks (id, organization_id, project_id, seq, title, rank)
     values ('t-secret-2', $1, 'pr-secret', 2, 'Second secret', 'W')`,
    [orgId]
  );
  await pg.query(
    `insert into public.task_dependencies (id, organization_id, project_id, task_id, blocked_by_id)
     values ('d-secret', $1, 'pr-secret', 't-secret-2', 't-secret')`,
    [orgId]
  );
  await pg.query(
    `insert into public.project_milestones (id, organization_id, project_id, name, date)
     values ('m-secret', $1, 'pr-secret', 'Launch', '2026-11-02')`,
    [orgId]
  );
  await pg.query(
    `insert into public.task_comment_reactions (id, organization_id, project_id, comment_id, user_id, emoji)
     values ('r-secret', $1, 'pr-secret', 'c-secret', $2, '👍')`,
    [orgId, creator]
  );
  await pg.query(
    `insert into public.task_counters (project_id, organization_id, next_seq) values ('pr-secret', $1, 3)`,
    [orgId]
  );
  await pg.query(
    `insert into public.notification_preferences (id, organization_id, user_id) values ('np-viewer', $1, $2)`,
    [orgId, seatedViewer]
  );
}, 120_000);

afterAll(async () => {
  await pg?.close();
});

describe("private Projects", () => {
  it("are invisible, with everything in them, to an Editor who is not seated", async () => {
    const projects = await visibleIds(outsider, "projects");
    expect(projects).toContain("pr-open");
    expect(projects).not.toContain("pr-secret");
    expect(await visibleIds(outsider, "tasks")).toEqual(["t-open"]);
    expect(await visibleIds(outsider, "task_comments")).toEqual([]);
  });

  it("are visible to a seated Viewer, to a seated creator and to an Admin", async () => {
    for (const user of [seatedViewer, creator, admin]) {
      expect(await visibleIds(user, "projects")).toContain("pr-secret");
      expect(await visibleIds(user, "tasks")).toEqual(["t-open", "t-secret", "t-secret-2"]);
    }
  });

  it("let their creator in only until somebody is seated", async () => {
    // Nobody seated yet: the creator's own draft, and nobody else's.
    expect(await visibleIds(outsider, "projects")).toContain("pr-draft");
    expect(await visibleIds(creator, "projects")).not.toContain("pr-draft");
    // Removed in Share: a creator is a member like any other (#1047).
    expect(await visibleIds(creator, "projects")).not.toContain("pr-left");
    expect(await visibleIds(seatedViewer, "projects")).toContain("pr-left");
  });

  it("let a creator read back the private Project they just inserted", async () => {
    const { rows } = await actingAs(
      outsider,
      `insert into public.projects (id, organization_id, name, key, visibility, created_by)
       values ('pr-fresh', $1, 'Fresh', 'FRS', 'private', $2) returning id`,
      [orgId, outsider]
    );
    expect(rows).toEqual([{ id: "pr-fresh" }]);
  });

  it("cannot be written into by an Editor who cannot see them", async () => {
    await expect(
      actingAs(
        outsider,
        `insert into public.tasks (id, organization_id, project_id, seq, title, rank)
         values ('t-sneak', $1, 'pr-secret', 9, 'Sneak', 'W')`,
        [orgId]
      )
    ).rejects.toThrow();
    const { rows } = await actingAs(outsider, `update public.tasks set title = 'pwned' where id = 't-secret' returning id`);
    expect(rows).toEqual([]);
  });
});

describe("the rest of a private Project", () => {
  it("hides its dependencies, milestones, reactions and counter from a Member who is not seated", async () => {
    for (const table of ["task_dependencies", "project_milestones", "task_comment_reactions"]) {
      expect(await visibleIds(outsider, table)).toEqual([]);
      expect(await visibleIds(seatedViewer, table)).toHaveLength(1);
    }
    const counters = async (user: string) =>
      ((await actingAs(user, `select project_id from public.task_counters`)).rows as { project_id: string }[]).map(
        (row) => row.project_id
      );
    expect(await counters(outsider)).not.toContain("pr-secret");
    expect(await counters(seatedViewer)).toContain("pr-secret");
  });

  it("refuses a Viewer a dependency or a milestone, and lets a seated Editor add both", async () => {
    await expect(
      actingAs(
        seatedViewer,
        `insert into public.task_dependencies (id, organization_id, project_id, task_id, blocked_by_id)
         values ('d-viewer', $1, 'pr-secret', 't-secret', 't-secret-2')`,
        [orgId]
      )
    ).rejects.toThrow();
    await expect(
      actingAs(
        seatedViewer,
        `insert into public.project_milestones (id, organization_id, project_id, name, date)
         values ('m-viewer', $1, 'pr-secret', 'Nope', '2026-12-01')`,
        [orgId]
      )
    ).rejects.toThrow();
    await actingAs(
      creator,
      `insert into public.project_milestones (id, organization_id, project_id, name, date)
       values ('m-creator', $1, 'pr-secret', 'Beta', '2026-10-20')`,
      [orgId]
    );
    const { rows } = await actingAs(outsider, `delete from public.project_milestones where id = 'm-creator' returning id`);
    expect(rows).toEqual([]);
  });

  it("lets a reader react as themselves only, and remove only their own reaction", async () => {
    await actingAs(
      seatedViewer,
      `insert into public.task_comment_reactions (id, organization_id, project_id, comment_id, user_id, emoji)
       values ('r-viewer', $1, 'pr-secret', 'c-secret', $2, '🎉')`,
      [orgId, seatedViewer]
    );
    await expect(
      actingAs(
        seatedViewer,
        `insert into public.task_comment_reactions (id, organization_id, project_id, comment_id, user_id, emoji)
         values ('r-forged', $1, 'pr-secret', 'c-secret', $2, '👀')`,
        [orgId, creator]
      )
    ).rejects.toThrow();
    const { rows } = await actingAs(seatedViewer, `delete from public.task_comment_reactions where id = 'r-secret' returning id`);
    expect(rows).toEqual([]);
  });

  it("gives a Member no write on the Task counter", async () => {
    await expect(
      actingAs(creator, `insert into public.task_counters (project_id, organization_id, next_seq) values ('pr-open', $1, 99)`, [
        orgId,
      ])
    ).rejects.toThrow();
  });
});

describe("project files", () => {
  it("follow their Project's visibility", async () => {
    expect(await visibleIds(outsider, "project_files")).toEqual([]);
    expect(await visibleIds(seatedViewer, "project_files")).toEqual(["f-secret"]);
    expect(await visibleIds(stranger, "project_files")).toEqual([]);
  });

  it("are added by an Editor as themselves and never by a Viewer", async () => {
    const add = (user: string, id: string, uploader: string) =>
      actingAs(
        user,
        `insert into public.project_files (id, organization_id, project_id, name, storage_path, size_bytes, uploaded_by)
         values ($1, $2, 'pr-open', 'a.txt', $3, 1, $4)`,
        [id, orgId, `org/${orgId}/projects/pr-open/${id}/a.txt`, uploader]
      );
    await add(outsider, "f-open", outsider);
    await expect(add(seatedViewer, "f-viewer", seatedViewer)).rejects.toThrow();
    await expect(add(outsider, "f-forged", creator)).rejects.toThrow();
    const { rows } = await actingAs(seatedViewer, `delete from public.project_files where id = 'f-open' returning id`);
    expect(rows).toEqual([]);
  });
});

describe("write guards (#1076 review)", () => {
  it("refuse a file whose object path names another Organization, and any later change of path", async () => {
    await expect(
      actingAs(
        outsider,
        `insert into public.project_files (id, organization_id, project_id, name, storage_path, size_bytes, uploaded_by)
         values ('f-cross', $1, 'pr-open', 'a.txt', $2, 1, $3)`,
        [orgId, `org/${foreignOrgId}/projects/pr-foreign/x/a.txt`, outsider]
      )
    ).rejects.toThrow(/set by the server/);
    await actingAs(
      outsider,
      `insert into public.project_files (id, organization_id, project_id, name, storage_path, size_bytes, uploaded_by)
       values ('f-guarded', $1, 'pr-open', 'a.txt', $2, 1, $3)`,
      [orgId, `org/${orgId}/projects/pr-open/f-guarded/a.txt`, outsider]
    );
    await expect(
      actingAs(outsider, `update public.project_files set storage_path = $1 where id = 'f-guarded'`, [
        `org/${orgId}/projects/pr-open/elsewhere/a.txt`,
      ])
    ).rejects.toThrow(/never changes/);
    const { rows } = await actingAs(outsider, `update public.project_files set name = 'b.txt' where id = 'f-guarded' returning name`);
    expect(rows).toEqual([{ name: "b.txt" }]);
  });

  it("derive a comment's mentions from its body and keep it on its Task", async () => {
    const { rows } = await actingAs(
      creator,
      `update public.task_comments set mentions = array['00000000-0000-4000-8000-000000000000']::uuid[]
       where id = 'c-secret' returning mentions`
    );
    expect(rows).toEqual([{ mentions: [] }]);
    await expect(
      actingAs(creator, `update public.task_comments set task_id = 't-secret-2' where id = 'c-secret'`)
    ).rejects.toThrow(/never change/);
  });

  it("let a recipient file a notification, and nothing else", async () => {
    const { rows } = await actingAs(
      seatedViewer,
      `update public.member_notifications set read_at = now(), archived_at = now(), snoozed_until = now()
       where id = 'n-viewer' returning id`
    );
    expect(rows).toEqual([{ id: "n-viewer" }]);
    await expect(
      actingAs(seatedViewer, `update public.member_notifications set kind = 'mentioned' where id = 'n-viewer'`)
    ).rejects.toThrow(/only changes how its recipient filed it/);
  });
});

describe("the Role ladder", () => {
  it("lets an Editor create a Task and refuses a Viewer", async () => {
    await actingAs(
      outsider,
      `insert into public.tasks (id, organization_id, project_id, seq, title, rank)
       values ('t-new', $1, 'pr-open', 2, 'New', 'W')`,
      [orgId]
    );
    await expect(
      actingAs(
        seatedViewer,
        `insert into public.tasks (id, organization_id, project_id, seq, title, rank)
         values ('t-viewer', $1, 'pr-open', 3, 'Nope', 'X')`,
        [orgId]
      )
    ).rejects.toThrow();
  });

  it("refuses a Viewer a Task number", async () => {
    await expect(actingAs(seatedViewer, `select public.next_task_seq('pr-open')`)).rejects.toThrow(/not authorized/);
    const { rows } = await actingAs(outsider, `select public.next_task_seq('pr-open') as seq`);
    expect((rows[0] as { seq: number }).seq).toBeGreaterThan(0);
  });

  it("lets a Viewer comment as themselves, never as somebody else", async () => {
    await actingAs(
      seatedViewer,
      `insert into public.task_comments (id, organization_id, project_id, task_id, author_member_id, body)
       values ('c-viewer', $1, 'pr-secret', 't-secret', $2, 'Question')`,
      [orgId, seatedViewer]
    );
    await expect(
      actingAs(
        seatedViewer,
        `insert into public.task_comments (id, organization_id, project_id, task_id, author_member_id, body)
         values ('c-forged', $1, 'pr-secret', 't-secret', $2, 'Forged')`,
        [orgId, creator]
      )
    ).rejects.toThrow();
    const { rows } = await actingAs(seatedViewer, `update public.task_comments set body = 'edited' where id = 'c-secret' returning id`);
    expect(rows).toEqual([]);
  });

  it("keeps a Saved View's rename to its creator or an Admin", async () => {
    await actingAs(
      creator,
      `insert into public.saved_views (id, organization_id, project_id, name, created_by)
       values ('v-1', $1, 'pr-open', 'Mine', $2)`,
      [orgId, creator]
    );
    const outsiderEdit = await actingAs(outsider, `update public.saved_views set name = 'Theirs' where id = 'v-1' returning id`);
    expect(outsiderEdit.rows).toEqual([]);
    const adminEdit = await actingAs(admin, `update public.saved_views set name = 'Admin' where id = 'v-1' returning id`);
    expect(adminEdit.rows).toHaveLength(1);
  });
});

describe("a Member's own rows", () => {
  it("shows a notification to its recipient only, and lets nobody insert one", async () => {
    expect(await visibleIds(seatedViewer, "member_notifications")).toEqual(["n-viewer"]);
    expect(await visibleIds(creator, "member_notifications")).toEqual([]);
    await expect(
      actingAs(
        creator,
        `insert into public.member_notifications (id, organization_id, recipient_id, kind, project_id, task_id)
         values ('n-forged', $1, $2, 'mentioned', 'pr-open', 't-open')`,
        [orgId, seatedViewer]
      )
    ).rejects.toThrow();
  });

  it("keeps favorites private and refuses a star on what you cannot see", async () => {
    await actingAs(
      creator,
      `insert into public.work_favorites (id, organization_id, user_id, project_id) values ('f-1', $1, $2, 'pr-secret')`,
      [orgId, creator]
    );
    expect(await visibleIds(admin, "work_favorites")).toEqual([]);
    await expect(
      actingAs(
        outsider,
        `insert into public.work_favorites (id, organization_id, user_id, project_id) values ('f-2', $1, $2, 'pr-secret')`,
        [orgId, outsider]
      )
    ).rejects.toThrow();
  });

  it("keeps notification preferences to their Member", async () => {
    expect(await visibleIds(seatedViewer, "notification_preferences")).toEqual(["np-viewer"]);
    expect(await visibleIds(admin, "notification_preferences")).toEqual([]);
    await expect(
      actingAs(
        creator,
        `insert into public.notification_preferences (id, organization_id, user_id) values ('np-forged', $1, $2)`,
        [orgId, outsider]
      )
    ).rejects.toThrow();
    const { rows } = await actingAs(
      creator,
      `update public.notification_preferences set email_assigned = false where id = 'np-viewer' returning id`
    );
    expect(rows).toEqual([]);
  });

  it("has no member write on the activity log", async () => {
    await expect(
      actingAs(
        creator,
        `insert into public.work_activity (id, organization_id, project_id, verb, actor_member_id)
         values ('a-forged', $1, 'pr-open', 'task.created', $2)`,
        [orgId, creator]
      )
    ).rejects.toThrow();
  });
});

describe("Project keys", () => {
  it("are derived for a writer that does not send one, unique in the Organization", async () => {
    // `OPN` is taken above; a writer that predates keys still gets a valid one.
    const { rows } = await pg.query(
      `insert into public.projects (id, organization_id, name)
       values ('pr-legacy-1', $1, 'Open Plan Notes'), ('pr-legacy-2', $1, 'Website')
       returning key`,
      [orgId]
    );
    expect((rows as { key: string }[]).map((row) => row.key)).toEqual(["OPN2", "WE"]);
  });
});

describe("the Organization line", () => {
  it("never shows another Organization's work", async () => {
    expect(await visibleIds(admin, "projects")).not.toContain("pr-foreign");
    expect(await visibleIds(admin, "tasks")).not.toContain("t-foreign");
    expect(await visibleIds(stranger, "tasks")).toEqual(["t-foreign"]);
  });

  it("refuses a Task stamped with the wrong Organization", async () => {
    await expect(
      actingAs(
        stranger,
        `insert into public.tasks (id, organization_id, project_id, seq, title, rank)
         values ('t-cross', $1, 'pr-foreign', 5, 'Cross', 'Y')`,
        [orgId]
      )
    ).rejects.toThrow();
  });

  it("keeps a Task's Improvement and Teammate in the Task's own Organization", async () => {
    await pg.query(
      `insert into public.improvements (id, organization_id, seq, title) values ('imp-theirs', $1, 1, 'Theirs')`,
      [foreignOrgId]
    );
    await pg.query(`insert into public.teammates (id, organization_id, name) values ('tm-theirs', $1, 'Sam')`, [
      foreignOrgId,
    ]);
    // Refused by the composite foreign keys, as the superuser too: no policy involved.
    await expect(pg.query(`update public.tasks set improvement_id = 'imp-theirs' where id = 't-open'`)).rejects.toThrow();
    await expect(pg.query(`update public.tasks set assignee_teammate_id = 'tm-theirs' where id = 't-open'`)).rejects.toThrow();
  });

  it("unassigns a removed Member's Tasks", async () => {
    // The membership guard refuses to leave an Organization without an owner.
    await seedUser("owner@work-test.edu", orgId, "owner");
    const leaver = await seedUser("leaver@work-test.edu", orgId, "editor");
    await pg.query(`update public.tasks set assignee_member_id = $1 where id = 't-open'`, [leaver]);
    await pg.query(`delete from public.organization_members where organization_id = $1 and user_id = $2`, [orgId, leaver]);
    const { rows } = await pg.query(`select assignee_member_id from public.tasks where id = 't-open'`);
    expect(rows).toEqual([{ assignee_member_id: null }]);
  });

  it("refuses a label from another Organization", async () => {
    await expect(
      actingAs(
        creator,
        `insert into public.task_label_links (id, organization_id, project_id, task_id, label_id)
         values ('ll-cross', $1, 'pr-open', 't-open', 'l-theirs')`,
        [orgId]
      )
    ).rejects.toThrow();
    await actingAs(
      creator,
      `insert into public.task_label_links (id, organization_id, project_id, task_id, label_id)
       values ('ll-ours', $1, 'pr-open', 't-open', 'l-ours')`,
      [orgId]
    );
  });
});
