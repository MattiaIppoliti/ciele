import type { SupabaseClient } from "@supabase/supabase-js";

export const PUBLIC_ASSETS_BUCKET = "public-assets";
export const ASSISTANT_AVATAR_MAX_BYTES = 2 * 1024 * 1024;

export type PublicAvatarKind = "assistant" | "organization" | "profile";

const IMAGE_EXTENSIONS: Record<string, string> = {
  "image/gif": "gif",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export function extensionForPublicImage(mimeType: string): string | null {
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

export function decodePublicImageDataUrl(
  dataUrl: string
): { mimeType: string; bytes: Uint8Array } {
  const match = /^data:([^;,]+);base64,(.+)$/i.exec(dataUrl.trim());
  if (!match) throw new Error("Expected a base64 image data URL");

  const mimeType = match[1].toLowerCase();
  if (!extensionForPublicImage(mimeType)) {
    throw new Error("Choose a PNG, JPEG, GIF, or WebP image");
  }

  const bytes = Uint8Array.from(Buffer.from(match[2].replace(/\s/g, ""), "base64"));
  const validation = validatePublicImageFile({ type: mimeType, size: bytes.byteLength });
  if (!validation.ok) throw new Error(validation.error);
  return { mimeType, bytes };
}

export function publicAvatarPath(input: {
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

export async function uploadPublicImageDataUrl(
  client: SupabaseClient,
  input: {
    organizationId: string;
    kind: PublicAvatarKind;
    dataUrl: string;
    id?: string;
  }
): Promise<{ path: string; publicUrl: string }> {
  const decoded = decodePublicImageDataUrl(input.dataUrl);
  const arrayBuffer = new ArrayBuffer(decoded.bytes.byteLength);
  new Uint8Array(arrayBuffer).set(decoded.bytes);
  const blob = new Blob([arrayBuffer], { type: decoded.mimeType });
  return uploadPublicImageAsset(client, {
    organizationId: input.organizationId,
    kind: input.kind,
    file: blob,
    id: input.id,
  });
}

/**
 * Knowledge-file originals, the uploaded binary retained so a Source can be
 * re-ingested (extract → enrich → chunk → embed) after the pipeline improves,
 * without the admin re-uploading. Unlike public avatars this bucket is
 * private: reads go through the service role server-side, and its RLS policies
 * keep one org's objects unreadable to another (see the storage migration).
 */
export const KNOWLEDGE_ORIGINALS_BUCKET = "knowledge-originals";
export const KNOWLEDGE_ORIGINAL_MAX_BYTES = 25 * 1024 * 1024;

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
  txt: "text/plain",
  text: "text/plain",
  md: "text/plain",
  markdown: "text/plain",
  csv: "text/csv",
  tsv: "text/tab-separated-values",
  json: "application/json",
  log: "text/plain",
};

const KNOWLEDGE_FILE_EXTENSIONS = new Set(
  Object.keys(KNOWLEDGE_FILE_CONTENT_TYPES)
);

export function knowledgeFileExtension(filename: string): string | null {
  const parts = filename.toLowerCase().split(".");
  const ext = parts.length > 1 ? parts[parts.length - 1] : "";
  return KNOWLEDGE_FILE_EXTENSIONS.has(ext) ? ext : null;
}

export function validateKnowledgeFile(file: {
  name: string;
  size: number;
}): { ok: true } | { ok: false; error: string } {
  if (!knowledgeFileExtension(file.name)) {
    return { ok: false, error: "Upload a PDF, Word (.docx), Markdown, or text file" };
  }
  if (file.size === 0) {
    return { ok: false, error: "The file is empty" };
  }
  if (file.size > KNOWLEDGE_ORIGINAL_MAX_BYTES) {
    return { ok: false, error: "File is too large - the maximum supported size is 25 MB" };
  }
  return { ok: true };
}

export function knowledgeOriginalPath(input: {
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

  const { error } = await client.storage
    .from(KNOWLEDGE_ORIGINALS_BUCKET)
    .upload(path, input.file, {
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
