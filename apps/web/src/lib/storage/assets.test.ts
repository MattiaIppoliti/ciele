import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  ASSISTANT_AVATAR_MAX_BYTES,
  decodePublicImageDataUrl,
  extensionForPublicImage,
  KNOWLEDGE_ORIGINAL_MAX_BYTES,
  knowledgeFileExtension,
  knowledgeOriginalPath,
  publicAvatarPath,
  validateKnowledgeFile,
  validatePublicImageFile,
} from "./assets";

describe("public asset helpers", () => {
  it("maps only safe browser image MIME types to extensions", () => {
    expect(extensionForPublicImage("image/png")).toBe("png");
    expect(extensionForPublicImage("image/jpeg")).toBe("jpg");
    expect(extensionForPublicImage("image/webp")).toBe("webp");
    expect(extensionForPublicImage("image/gif")).toBe("gif");
    expect(extensionForPublicImage("image/svg+xml")).toBeNull();
  });

  it("builds tenant-scoped avatar paths with no user filename", () => {
    expect(
      publicAvatarPath({
        organizationId: "org_123",
        kind: "assistant",
        mimeType: "image/png",
        id: "asset_123",
      })
    ).toBe("org/org_123/avatars/assistant/asset_123.png");
  });

  it("scopes organization logo and profile photo paths under the org prefix", () => {
    expect(
      publicAvatarPath({
        organizationId: "org_123",
        kind: "organization",
        mimeType: "image/jpeg",
        id: "logo_1",
      })
    ).toBe("org/org_123/avatars/organization/logo_1.jpg");
    expect(
      publicAvatarPath({
        organizationId: "org_123",
        kind: "profile",
        mimeType: "image/webp",
        id: "photo_1",
      })
    ).toBe("org/org_123/avatars/profile/photo_1.webp");
  });

  it("validates image type and size", () => {
    expect(
      validatePublicImageFile({
        type: "image/png",
        size: ASSISTANT_AVATAR_MAX_BYTES,
      })
    ).toEqual({ ok: true });
    expect(
      validatePublicImageFile({
        type: "image/svg+xml",
        size: 100,
      })
    ).toEqual({ ok: false, error: "Choose a PNG, JPEG, GIF, or WebP image" });
    expect(
      validatePublicImageFile({
        type: "image/png",
        size: ASSISTANT_AVATAR_MAX_BYTES + 1,
      })
    ).toEqual({
      ok: false,
      error: "Image is too large - the maximum supported size is 2 MB",
    });
  });

  it("decodes supported legacy base64 data URLs", () => {
    const decoded = decodePublicImageDataUrl("data:image/png;base64,aGVsbG8=");
    expect(decoded.mimeType).toBe("image/png");
    expect(Buffer.from(decoded.bytes).toString("utf8")).toBe("hello");
  });

  it("rejects legacy data URLs that are not safe image assets", () => {
    expect(() => decodePublicImageDataUrl("https://example.edu/avatar.png")).toThrow(
      "Expected a base64 image data URL"
    );
    expect(() =>
      decodePublicImageDataUrl("data:image/svg+xml;base64,PHN2Zy8+")
    ).toThrow("Choose a PNG, JPEG, GIF, or WebP image");
  });
});

describe("knowledge original helpers", () => {
  it("classifies only extractor-supported file types (PDF/DOCX/text)", () => {
    expect(knowledgeFileExtension("Syllabus.PDF")).toBe("pdf");
    expect(knowledgeFileExtension("notes.docx")).toBe("docx");
    expect(knowledgeFileExtension("readme.md")).toBe("md");
    expect(knowledgeFileExtension("data.csv")).toBe("csv");
    expect(knowledgeFileExtension("logo.png")).toBeNull();
    expect(knowledgeFileExtension("archive.zip")).toBeNull();
    expect(knowledgeFileExtension("noextension")).toBeNull();
  });

  it("builds tenant-scoped original paths with no user filename", () => {
    expect(
      knowledgeOriginalPath({
        organizationId: "org_123",
        filename: "Course Handbook.pdf",
        id: "obj_123",
      })
    ).toBe("org/org_123/knowledge/obj_123.pdf");
  });

  it("enforces type and size limits at upload", () => {
    expect(validateKnowledgeFile({ name: "a.pdf", size: 10 })).toEqual({ ok: true });
    expect(validateKnowledgeFile({ name: "a.png", size: 10 })).toEqual({
      ok: false,
      error: "Upload a PDF, Word (.docx), Markdown, or text file",
    });
    expect(validateKnowledgeFile({ name: "a.pdf", size: 0 })).toEqual({
      ok: false,
      error: "The file is empty",
    });
    expect(
      validateKnowledgeFile({ name: "a.pdf", size: KNOWLEDGE_ORIGINAL_MAX_BYTES + 1 })
    ).toEqual({
      ok: false,
      error: "File is too large - the maximum supported size is 25 MB",
    });
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
