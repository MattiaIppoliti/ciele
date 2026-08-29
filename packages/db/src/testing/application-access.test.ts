import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createSchemaLoadedPglite } from "./supabase-contract-harness";

let pg: PGlite;
let orgId: string;
let otherOrgId: string;
let viewer: string;
let editor: string;
let admin: string;

async function seedUser(role: "viewer" | "editor" | "admin") {
  const id = randomUUID();
  await pg.query(
    "insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, '{}')",
    [id, `${role}-${id}@application.test`]
  );
  await pg.query(
    `insert into public.organization_members (organization_id, user_id, role)
     values ($1, $2, $3)`,
    [orgId, id, role]
  );
  return id;
}

async function actingAs(userId: string, sql: string, params: unknown[] = []) {
  await pg.query("select set_config('request.jwt.claim.sub', $1, false)", [userId]);
  await pg.exec("set role authenticated");
  try {
    return await pg.query(sql, params);
  } finally {
    await pg.exec("reset role");
  }
}

beforeAll(async () => {
  pg = await createSchemaLoadedPglite();
  orgId = randomUUID();
  otherOrgId = randomUUID();
  await pg.query(
    "insert into public.organizations (id, name) values ($1, 'Applications'), ($2, 'Foreign')",
    [orgId, otherOrgId]
  );
  viewer = await seedUser("viewer");
  editor = await seedUser("editor");
  admin = await seedUser("admin");
  await pg.exec(`
    grant usage on schema public, private to authenticated;
    grant select, insert, update, delete on all tables in schema public to authenticated;
  `);
  await pg.query(
    `insert into public.assistants (id, organization_id, title)
     values ('app-assistant', $1, 'Application Assistant'),
            ('foreign-assistant', $2, 'Foreign Assistant')`,
    [orgId, otherOrgId]
  );
  await pg.query(
    `insert into public.knowledge_collections (id, organization_id, name)
     values ('app-library', $1, 'Application Library')`,
    [orgId]
  );
  await pg.query(
    `insert into public.application_connections
       (id, organization_id, provider, name, status, sealed_credentials)
     values ('app-connection', $1, 'slack', 'Support Slack', 'connected', 'ciphertext-secret')`,
    [orgId]
  );
  await pg.query(
    `insert into public.application_connections
       (id, organization_id, owner_type, owner_member_id, provider, name, status, sealed_credentials)
     values ('personal-connection', $1, 'member', $2, 'google_drive', 'Editor Drive',
       'connected', 'personal-ciphertext')`,
    [orgId, editor]
  );
  await pg.query(
    `insert into public.application_imports
       (id, organization_id, connection_id, collection_id, name)
     values ('app-import', $1, 'app-connection', 'app-library', 'Support')`,
    [orgId]
  );
  await pg.exec(
    `insert into public.sources (id, collection_id, name, kind)
     values ('ordinary-source', 'app-library', 'Handbook', 'file')`
  );
}, 120_000);

afterAll(async () => pg?.close());

describe("Application connector authenticated RLS", () => {
  it("shows members redacted health while only Admins can select ciphertext", async () => {
    expect(
      (await actingAs(viewer, "select id from public.application_connections_safe")).rows
    ).toHaveLength(1);
    expect(
      (await actingAs(editor, "select id from public.application_connections_safe order by id"))
        .rows
    ).toEqual([{ id: "app-connection" }, { id: "personal-connection" }]);
    expect(
      (await actingAs(viewer, "select sealed_credentials from public.application_connections")).rows
    ).toHaveLength(0);
    expect(
      (await actingAs(editor, "select sealed_credentials from public.application_connections")).rows
    ).toHaveLength(0);
    expect(
      (await actingAs(admin, "select sealed_credentials from public.application_connections")).rows
    ).toEqual(
      expect.arrayContaining([
        { sealed_credentials: "ciphertext-secret" },
        { sealed_credentials: "personal-ciphertext" },
      ])
    );
  });

  it("refuses guessed cross-org Assistant links even for Editors", async () => {
    await expect(
      actingAs(
        editor,
        `insert into public.application_import_assistants (import_id, assistant_id)
         values ('app-import', 'foreign-assistant')`
      )
    ).rejects.toThrow();
  });

  it("rolls back Import create/update when an Assistant link is invalid", async () => {
    await expect(
      actingAs(
        editor,
        `select public.create_application_import_with_assistants(
          'rolled-back-import', $1, 'app-connection', 'app-library', 'Bad create',
          '{}'::jsonb, 'manual', true, array['foreign-assistant']::text[]
        )`,
        [orgId]
      )
    ).rejects.toThrow();
    expect(
      (await pg.query(
        "select id from public.application_imports where id = 'rolled-back-import'"
      )).rows
    ).toEqual([]);

    await pg.exec(
      `insert into public.application_import_assistants (import_id, assistant_id)
       values ('app-import', 'app-assistant')`
    );
    await expect(
      actingAs(
        editor,
        `select public.update_application_import_with_assistants(
          'app-import', '{"name":"Should roll back"}'::jsonb,
          array['foreign-assistant']::text[]
        )`
      )
    ).rejects.toThrow();
    expect(
      (await pg.query("select name from public.application_imports where id = 'app-import'")).rows
    ).toEqual([{ name: "Support" }]);
    expect(
      (await pg.query(
        "select assistant_id from public.application_import_assistants where import_id = 'app-import'"
      )).rows
    ).toEqual([{ assistant_id: "app-assistant" }]);
  });

  it("does not expose the worker-only Source-scope RPC to authenticated users", async () => {
    await expect(
      actingAs(
        editor,
        "select public.sync_application_source_assistant_scope('app-import', 'ordinary-source')"
      )
    ).rejects.toThrow();
  });

  it("lets Editors consume their own OAuth state and refuses Viewers", async () => {
    const nonce = `nonce-${randomUUID()}`;
    await actingAs(
      admin,
      `insert into public.application_oauth_nonces
       (nonce, organization_id, member_id, expires_at)
       values ($1, $2, $3, now() + interval '10 minutes')`,
      [nonce, orgId, admin]
    );
    const first = await actingAs(
      admin,
      "select public.consume_application_oauth_nonce($1, $2, $3, now()) as consumed",
      [nonce, orgId, admin]
    );
    expect(first.rows).toEqual([{ consumed: true }]);
    const replay = await actingAs(
      admin,
      "select public.consume_application_oauth_nonce($1, $2, $3, now()) as consumed",
      [nonce, orgId, admin]
    );
    expect(replay.rows).toEqual([{ consumed: false }]);
    const editorNonce = `editor-${nonce}`;
    await actingAs(
      editor,
      `insert into public.application_oauth_nonces
       (nonce, organization_id, member_id, expires_at)
       values ($1, $2, $3, now() + interval '10 minutes')`,
      [editorNonce, orgId, editor]
    );
    expect(
      (
        await actingAs(
          editor,
          "select public.consume_application_oauth_nonce($1, $2, $3, now()) as consumed",
          [editorNonce, orgId, editor]
        )
      ).rows
    ).toEqual([{ consumed: true }]);
    await expect(
      actingAs(
        viewer,
        `insert into public.application_oauth_nonces
         (nonce, organization_id, member_id, expires_at)
         values ($1, $2, $3, now() + interval '10 minutes')`,
        [`viewer-${nonce}`, orgId, viewer]
      )
    ).rejects.toThrow();
  });
});
