import type { SupabaseClient } from "@supabase/supabase-js";

const PUBLIC_ASSETS_BUCKET = "public-assets";
const ASSISTANT_AVATAR_MAX_BYTES = 2 * 1024 * 1024;

type PublicAvatarKind = "assistant" | "organization" | "profile";

const IMAGE_EXTENSIONS: Record<string, string> = {
  "image/gif": "gif",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

function extensionForPublicImage(mimeType: string): string | null {
  return IMAGE_EXTENSIONS[mimeType.toLowerCase()] ?? null;
}

export function validatePublicImageFile(file: {
  size: number;
  type: string;
}): { ok: true } | { ok: false; error: string } {
  if (!extensionForPublicImage(file.type)) {
    return { ok: false, error: "Choose a PNG, JPEG, GIF, or WebP image" };
  }
  if (file.size > ASSISTANT_AVATAR_MAX_BYTES) {
    return { ok: false, error: "Image is too large - the maximum supported size is 2 MB" };
  }
  return { ok: true };
}

function publicAvatarPath(input: {
  organizationId: string;
  kind: PublicAvatarKind;
  mimeType: string;
  id?: string;
}): string {
  const ext = extensionForPublicImage(input.mimeType);
  if (!ext) throw new Error("Unsupported image type");
  const id = input.id ?? crypto.randomUUID();
  return `org/${input.organizationId}/avatars/${input.kind}/${id}.${ext}`;
}

export async function uploadPublicImageAsset(
  client: SupabaseClient,
  input: {
    organizationId: string;
    kind: PublicAvatarKind;
    file: Blob;
    id?: string;
  }
): Promise<{ path: string; publicUrl: string }> {
  const validation = validatePublicImageFile(input.file);
  if (!validation.ok) throw new Error(validation.error);

  const path = publicAvatarPath({
    organizationId: input.organizationId,
    kind: input.kind,
    mimeType: input.file.type,
    id: input.id,
  });

  const { error } = await client.storage
    .from(PUBLIC_ASSETS_BUCKET)
    .upload(path, input.file, {
      cacheControl: "31536000",
      contentType: input.file.type,
      upsert: false,
    });
  if (error) throw error;

  const { data } = client.storage.from(PUBLIC_ASSETS_BUCKET).getPublicUrl(path);
  return { path, publicUrl: data.publicUrl };
}

/**
 * The whole round trip from an upload form's `file` field to a public image
 * URL, refusing in the order a Member can act on: no file, the wrong file,
 * then a deployment without storage (`client` null). The caller writes the
 * URL onto its own row; that write is the only thing the three image forms
 * (Organization logo, profile photo, Assistant avatar) do differently.
 */
export async function uploadPublicImageFromForm(
  client: SupabaseClient | null,
  formData: FormData,
  input: { organizationId: string; kind: PublicAvatarKind },
): Promise<{ publicUrl: string; error?: undefined } | { error: string }> {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Choose an image file" };
  }
  const validation = validatePublicImageFile(file);
  if (!validation.ok) return { error: validation.error };
  if (!client) return { error: "Object storage is not configured" };
  const { publicUrl } = await uploadPublicImageAsset(client, { ...input, file });
  return { publicUrl };
}

/**
 * Knowledge-file originals, the uploaded binary retained so a Source can be
 * re-ingested (extract → enrich → chunk → embed) after the pipeline improves,
 * without the admin re-uploading. Unlike public avatars this bucket is
 * private: reads go through the service role server-side, and its RLS policies
 * keep one org's objects unreadable to another (see the storage migration).
 */
export const KNOWLEDGE_ORIGINALS_BUCKET = "knowledge-originals";
const KNOWLEDGE_ORIGINAL_MAX_BYTES = 25 * 1024 * 1024;

/**
 * Extensions the ingestion extractors can re-read (`runtime/extract.ts`), each
 * mapped to the Content-Type the stored object gets: PDF and DOCX have dedicated
 * parsers, everything else is decoded as text.
 *
 * One map, not a set plus a lookup, so the two can never disagree: the accepted
 * set below is its key list. The type comes from the validated extension and
 * never from the uploader's `File.type`, because Storage replays the stored type
 * on a signed-URL GET, so a part named `notes.txt` that declared
 * `Content-Type: text/html` used to render as markup instead of being shown.
 */
const KNOWLEDGE_FILE_CONTENT_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  txt: "text/plain",
  text: "text/plain",
  md: "text/plain",
  markdown: "text/plain",
  csv: "text/csv",
  tsv: "text/tab-separated-values",
  json: "application/json",
  log: "text/plain",
};

function knowledgeFileExtension(filename: string): string | null {
  const parts = filename.toLowerCase().split(".");
  const ext = parts.length > 1 ? parts[parts.length - 1] : "";
  return Object.hasOwn(KNOWLEDGE_FILE_CONTENT_TYPES, ext) ? ext : null;
}

export function validateKnowledgeFile(file: {
  name: string;
  size: number;
}): { ok: true } | { ok: false; error: string } {
  if (!knowledgeFileExtension(file.name)) {
    return { ok: false, error: "Upload a PDF, Word, PowerPoint, Excel, Markdown, or text file" };
  }
  if (file.size === 0) {
    return { ok: false, error: "The file is empty" };
  }
  if (file.size > KNOWLEDGE_ORIGINAL_MAX_BYTES) {
    return { ok: false, error: "File is too large - the maximum supported size is 25 MB" };
  }
  return { ok: true };
}

function knowledgeOriginalPath(input: {
  organizationId: string;
  filename: string;
  id?: string;
}): string {
  const ext = knowledgeFileExtension(input.filename);
  if (!ext) throw new Error("Unsupported knowledge file type");
  const id = input.id ?? crypto.randomUUID();
  return `org/${input.organizationId}/knowledge/${id}.${ext}`;
}

export async function uploadKnowledgeOriginal(
  client: SupabaseClient,
  input: { organizationId: string; file: File; id?: string }
): Promise<{ path: string }> {
  const validation = validateKnowledgeFile(input.file);
  if (!validation.ok) throw new Error(validation.error);

  const path = knowledgeOriginalPath({
    organizationId: input.organizationId,
    filename: input.file.name,
    id: input.id,
  });

  // The bytes, not the File: supabase-js sends a Blob body as multipart with
  // the Blob's own type and ignores `contentType`, so a browser's
  // `text/markdown` for a .md file reached the bucket allowlist and was refused.
  const { error } = await client.storage
    .from(KNOWLEDGE_ORIGINALS_BUCKET)
    .upload(path, await input.file.arrayBuffer(), {
      cacheControl: "0",
      contentType:
        KNOWLEDGE_FILE_CONTENT_TYPES[
          knowledgeFileExtension(input.file.name) ?? ""
        ] ?? "application/octet-stream",
      upsert: false,
    });
  if (error) throw error;
  return { path };
}

export async function downloadKnowledgeOriginal(
  client: SupabaseClient,
  path: string
): Promise<ArrayBuffer> {
  const { data, error } = await client.storage
    .from(KNOWLEDGE_ORIGINALS_BUCKET)
    .download(path);
  if (error) throw error;
  return data.arrayBuffer();
}

/** Deletes knowledge originals by path; a path already gone is not an error. */
export async function removeKnowledgeOriginals(
  client: SupabaseClient,
  paths: string[]
): Promise<void> {
  if (paths.length === 0) return;
  const { error } = await client.storage
    .from(KNOWLEDGE_ORIGINALS_BUCKET)
    .remove(paths);
  if (error) throw error;
}
