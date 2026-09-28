import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  uploadKnowledgeOriginal,
  uploadPublicImageAsset,
  uploadPublicImageFromForm,
  validateKnowledgeFile,
  validatePublicImageFile,
} from "./assets";

const AVATAR_MAX_BYTES = 2 * 1024 * 1024;
const ORIGINAL_MAX_BYTES = 25 * 1024 * 1024;

/** Captures upload paths and types; the storage layer itself is not under test. */
function fakeClient(
  uploads: Array<{ bucket: string; path: string; contentType?: string }>
) {
  return {
    storage: {
      from: (bucket: string) => ({
        upload: async (path: string, _body: unknown, options?: { contentType?: string }) => {
          uploads.push({ bucket, path, contentType: options?.contentType });
          return { error: null };
        },
        getPublicUrl: (path: string) => ({
          data: { publicUrl: `https://cdn.test/${path}` },
        }),
      }),
    },
  } as unknown as SupabaseClient;
}

describe("public asset uploads", () => {
  it("builds tenant-scoped avatar paths with no user filename, per kind", async () => {
    const uploads: Array<{ bucket: string; path: string }> = [];
    const client = fakeClient(uploads);
    const cases = [
      { kind: "assistant", type: "image/png", id: "asset_123", ext: "png" },
      { kind: "organization", type: "image/jpeg", id: "logo_1", ext: "jpg" },
      { kind: "profile", type: "image/webp", id: "photo_1", ext: "webp" },
    ] as const;
    for (const c of cases) {
      const { path, publicUrl } = await uploadPublicImageAsset(client, {
        organizationId: "org_123",
        kind: c.kind,
        file: new Blob(["x"], { type: c.type }),
        id: c.id,
      });
      expect(path).toBe(`org/org_123/avatars/${c.kind}/${c.id}.${c.ext}`);
      expect(publicUrl).toBe(`https://cdn.test/${path}`);
    }
    expect(uploads.map((u) => u.bucket)).toEqual([
      "public-assets",
      "public-assets",
      "public-assets",
    ]);
  });

  it("validates image type and size (only safe browser image MIME types)", () => {
    expect(
      validatePublicImageFile({ type: "image/png", size: AVATAR_MAX_BYTES })
    ).toEqual({ ok: true });
    expect(validatePublicImageFile({ type: "image/gif", size: 100 })).toEqual({
      ok: true,
    });
    expect(
      validatePublicImageFile({ type: "image/svg+xml", size: 100 })
    ).toEqual({ ok: false, error: "Choose a PNG, JPEG, GIF, or WebP image" });
    expect(
      validatePublicImageFile({ type: "image/png", size: AVATAR_MAX_BYTES + 1 })
    ).toEqual({
      ok: false,
      error: "Image is too large - the maximum supported size is 2 MB",
    });
  });
});

describe("knowledge original uploads", () => {
  it("builds tenant-scoped original paths with no user filename", async () => {
    const uploads: Array<{ bucket: string; path: string }> = [];
    const { path } = await uploadKnowledgeOriginal(fakeClient(uploads), {
      organizationId: "org_123",
      file: new File(["x"], "Course Handbook.PDF"),
      id: "obj_123",
    });
    expect(path).toBe("org/org_123/knowledge/obj_123.pdf");
    expect(uploads[0].bucket).toBe("knowledge-originals");
  });

  it("accepts PowerPoint and Excel originals, stored under their own content type", async () => {
    expect(validateKnowledgeFile({ name: "deck.pptx", size: 10 })).toEqual({ ok: true });
    expect(validateKnowledgeFile({ name: "Rates.XLSX", size: 10 })).toEqual({ ok: true });
    const uploads: Array<{ bucket: string; path: string; contentType?: string }> = [];
    for (const name of ["deck.pptx", "Rates.XLSX"]) {
      await uploadKnowledgeOriginal(fakeClient(uploads), {
        organizationId: "org_123",
        file: new File(["x"], name),
        id: "obj",
      });
    }
    expect(uploads).toEqual([
      {
        bucket: "knowledge-originals",
        path: "org/org_123/knowledge/obj.pptx",
        contentType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      },
      {
        bucket: "knowledge-originals",
        path: "org/org_123/knowledge/obj.xlsx",
        contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      },
    ]);
  });

  it("stores the extension-derived type, never the browser's File.type", async () => {
    const sent: Array<{ body: unknown; contentType?: string }> = [];
    const client = {
      storage: {
        from: () => ({
          upload: async (_path: string, body: unknown, options?: { contentType?: string }) => {
            sent.push({ body, contentType: options?.contentType });
            return { error: null };
          },
        }),
      },
    } as unknown as SupabaseClient;
    await uploadKnowledgeOriginal(client, {
      organizationId: "org_123",
      file: new File(["# notes"], "notes.md", { type: "text/markdown" }),
    });
    // supabase-js sends a Blob body with the Blob's own type, so the type
    // storage receives is the body's when it is a Blob, `contentType` otherwise.
    const { body, contentType } = sent[0];
    expect(body instanceof Blob ? body.type : contentType).toBe("text/plain");
  });

  it("enforces type and size limits at upload (documents and text only)", () => {
    expect(validateKnowledgeFile({ name: "a.pdf", size: 10 })).toEqual({ ok: true });
    expect(validateKnowledgeFile({ name: "notes.docx", size: 10 })).toEqual({ ok: true });
    expect(validateKnowledgeFile({ name: "readme.md", size: 10 })).toEqual({ ok: true });
    expect(validateKnowledgeFile({ name: "data.csv", size: 10 })).toEqual({ ok: true });
    expect(validateKnowledgeFile({ name: "a.png", size: 10 })).toEqual({
      ok: false,
      error: "Upload a PDF, Word, PowerPoint, Excel, Markdown, or text file",
    });
    expect(validateKnowledgeFile({ name: "noextension", size: 10 })).toEqual({
      ok: false,
      error: "Upload a PDF, Word, PowerPoint, Excel, Markdown, or text file",
    });
    expect(validateKnowledgeFile({ name: "a.pdf", size: 0 })).toEqual({
      ok: false,
      error: "The file is empty",
    });
    expect(
      validateKnowledgeFile({ name: "a.pdf", size: ORIGINAL_MAX_BYTES + 1 })
    ).toEqual({
      ok: false,
      error: "File is too large - the maximum supported size is 25 MB",
    });
  });
});

describe("knowledge-originals bucket MIME allowlist", () => {
  // The bucket refuses any type it does not list, so every type the uploader
  // writes has to be in the newest migration that sets the list. A type added
  // to the app alone would pass every unit test and fail every real upload.
  it("lists every content type the uploader stores", async () => {
    const dir = resolve(
      dirname(fileURLToPath(import.meta.url)),
      "../../../../../supabase/migrations"
    );
    const latest = readdirSync(dir)
      .filter((file) => file.endsWith(".sql"))
      .sort()
      .map((file) => readFileSync(resolve(dir, file), "utf8"))
      .filter((sql) => /allowed_mime_types[\s\S]*where id = 'knowledge-originals'/.test(sql))
      .at(-1);
    const uploads: Array<{ bucket: string; path: string; contentType?: string }> = [];
    for (const ext of ["pdf", "docx", "pptx", "xlsx", "txt", "text", "md", "markdown", "csv", "tsv", "json", "log"]) {
      await uploadKnowledgeOriginal(fakeClient(uploads), {
        organizationId: "org_123",
        file: new File(["x"], `f.${ext}`),
        id: "obj",
      });
    }
    for (const { contentType } of uploads) expect(latest).toContain(`'${contentType}'`);
  });
});

describe("knowledge-originals bucket tenancy policy", () => {
  const migration = readFileSync(
    resolve(
      dirname(fileURLToPath(import.meta.url)),
      "../../../../../supabase/migrations/20260711120000_knowledge_originals_storage.sql"
    ),
    "utf8"
  );

  it("provisions a private (non-public) bucket", () => {
    expect(migration).toMatch(
      /insert into storage\.buckets[\s\S]*?'knowledge-originals'[\s\S]*?false/
    );
  });

  it("never grants public read (unlike the avatars bucket)", () => {
    expect(migration).not.toMatch(/for select\s+to public/i);
  });

  it("scopes read, insert, update and delete to the org named in the object path", () => {
    // Every object policy must gate on membership of the org in path segment 2,
    // so one org's members cannot read or mutate another org's originals.
    const gate = /m\.organization_id::text = \(storage\.foldername\(name\)\)\[2\]/g;
    expect(migration.match(gate)?.length ?? 0).toBeGreaterThanOrEqual(4);
    for (const op of ["select", "insert", "update", "delete"]) {
      expect(migration).toMatch(new RegExp(`for ${op}`));
    }
  });
});

describe("public-assets storage policies (tenancy)", () => {
  const migration = readFileSync(
    fileURLToPath(
      new URL(
        "../../../../../supabase/migrations/0040_public_assets_storage.sql",
        import.meta.url
      )
    ),
    "utf8"
  );

  it("scopes every write to a member of the object path's own organization", () => {
    // Assistant avatars, org logos and profile photos all live under the same
    // bucket, so the same write policies gate cross-org access for all three.
    for (const command of ["insert", "update", "delete"]) {
      const policy = new RegExp(
        `create policy "[^"]*${command} public assets"[\\s\\S]*?for ${command}`,
        "i"
      );
      expect(migration).toMatch(policy);
    }
    // The membership predicate keys the folder's org segment to the caller.
    expect(migration).toContain(
      "m.organization_id::text = (storage.foldername(name))[2]"
    );
    expect(migration).toContain("m.user_id = auth.uid()");
  });

  it("keeps object reads public by design but blocks listing", () => {
    // 0040 originally granted a broad `for select to public` policy, which let
    // any client enumerate the bucket with .list(). The advisor-hardening
    // migration drops it: a public bucket still serves objects by URL without a
    // SELECT policy (widget avatars/logos are fetched by stored URL, never
    // listed), so reads stay public while directory listing is blocked.
    expect(migration).toMatch(
      /create policy "public read public assets"[\s\S]*?for select\s+to public/i
    );
    const hardening = readFileSync(
      fileURLToPath(
        new URL(
          "../../../../../supabase/migrations/20260711160000_advisor_hardening.sql",
          import.meta.url
        )
      ),
      "utf8"
    );
    expect(hardening).toMatch(
      /drop policy if exists "public read public assets" on storage\.objects/i
    );
  });
});

describe("uploadPublicImageFromForm", () => {
  const input = { organizationId: "org_123", kind: "organization" } as const;
  const form = (file?: Blob) => {
    const data = new FormData();
    if (file) data.set("file", file, "logo.png");
    return data;
  };

  it("uploads the form's image and answers its public URL", async () => {
    const uploads: Array<{ bucket: string; path: string }> = [];
    const result = await uploadPublicImageFromForm(
      fakeClient(uploads),
      form(new Blob(["x"], { type: "image/png" })),
      input,
    );
    expect(result.error).toBeUndefined();
    expect(uploads).toHaveLength(1);
    expect(uploads[0].path).toMatch(/^org\/org_123\/avatars\/organization\/.+\.png$/);
    expect("publicUrl" in result && result.publicUrl).toBe(`https://cdn.test/${uploads[0].path}`);
  });

  it("refuses in the order a Member can act on, and uploads nothing", async () => {
    const uploads: Array<{ bucket: string; path: string }> = [];
    const client = fakeClient(uploads);
    expect(await uploadPublicImageFromForm(client, form(), input)).toEqual({
      error: "Choose an image file",
    });
    expect(
      await uploadPublicImageFromForm(client, form(new Blob(["x"], { type: "image/svg+xml" })), input),
    ).toEqual({ error: "Choose a PNG, JPEG, GIF, or WebP image" });
    // A bad file is named before a missing store: the Member can fix the first.
    expect(
      await uploadPublicImageFromForm(null, form(new Blob(["x"], { type: "image/svg+xml" })), input),
    ).toEqual({ error: "Choose a PNG, JPEG, GIF, or WebP image" });
    expect(
      await uploadPublicImageFromForm(null, form(new Blob(["x"], { type: "image/png" })), input),
    ).toEqual({ error: "Object storage is not configured" });
    expect(uploads).toEqual([]);
  });
});
