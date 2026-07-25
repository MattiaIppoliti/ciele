import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const bucket = "public-assets";
const maxBytes = 2 * 1024 * 1024;
const extensions = new Map([
  ["image/gif", "gif"],
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
]);

const dryRun = process.argv.includes("--dry-run");
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error(
    "NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required"
  );
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false },
});

function decodeDataUrl(dataUrl) {
  const match = /^data:([^;,]+);base64,(.+)$/i.exec(dataUrl.trim());
  if (!match) throw new Error("Expected a base64 image data URL");

  const mimeType = match[1].toLowerCase();
  const ext = extensions.get(mimeType);
  if (!ext) throw new Error(`Unsupported image MIME type: ${mimeType}`);

  const bytes = Buffer.from(match[2].replace(/\s/g, ""), "base64");
  if (bytes.byteLength > maxBytes) {
    throw new Error(`Image is too large: ${bytes.byteLength} bytes`);
  }
  return { mimeType, ext, bytes };
}

const { data: assistants, error: listError } = await supabase
  .from("assistants")
  .select("id, organization_id, avatar_url")
  .like("avatar_url", "data:image/%;base64,%");

if (listError) throw listError;

console.log(
  `${dryRun ? "Would backfill" : "Backfilling"} ${assistants.length} assistant avatar(s)`
);

let converted = 0;
for (const assistant of assistants) {
  if (!assistant.organization_id || !assistant.avatar_url) continue;

  const decoded = decodeDataUrl(assistant.avatar_url);
  const path = `org/${assistant.organization_id}/avatars/assistant/${randomUUID()}.${decoded.ext}`;
  const publicUrl = `${supabaseUrl}/storage/v1/object/public/${bucket}/${path}`;

  if (!dryRun) {
    const { error: uploadError } = await supabase.storage
      .from(bucket)
      .upload(path, decoded.bytes, {
        cacheControl: "31536000",
        contentType: decoded.mimeType,
        upsert: false,
      });
    if (uploadError) throw uploadError;

    const { error: updateError } = await supabase
      .from("assistants")
      .update({ avatar_url: publicUrl })
      .eq("id", assistant.id);
    if (updateError) throw updateError;
  }

  converted += 1;
  console.log(`${assistant.id} -> ${path}`);
}

console.log(`${dryRun ? "Validated" : "Converted"} ${converted} assistant avatar(s)`);
