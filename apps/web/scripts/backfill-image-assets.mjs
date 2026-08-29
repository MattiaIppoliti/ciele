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

// Column-per-image-type targets that still hold legacy base64 data URLs.
// Assistant avatars have their own script (backfill:assistant-avatars).
const targets = [
  {
    kind: "organization",
    table: "organizations",
    idColumn: "id",
    orgColumn: "id",
    valueColumn: "logo_url",
  },
  {
    kind: "profile",
    table: "profiles",
    idColumn: "id",
    orgColumn: null,
    valueColumn: "avatar_url",
  },
];

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

async function resolveOrganizationId(target, row) {
  if (target.orgColumn) return row[target.orgColumn];
  // Profiles are not org-scoped; pin the object under any org the user is a
  // member of so it satisfies the org-prefix storage layout.
  const { data, error } = await supabase
    .from("organization_members")
    .select("organization_id")
    .eq("user_id", row[target.idColumn])
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data?.organization_id ?? null;
}

let converted = 0;
for (const target of targets) {
  const columns = new Set([target.idColumn, target.valueColumn]);
  if (target.orgColumn) columns.add(target.orgColumn);
  const { data: rows, error: listError } = await supabase
    .from(target.table)
    .select([...columns].join(", "))
    .like(target.valueColumn, "data:image/%;base64,%");
  if (listError) throw listError;

  console.log(
    `${dryRun ? "Would backfill" : "Backfilling"} ${rows.length} ${target.kind} image(s)`
  );

  for (const row of rows) {
    const value = row[target.valueColumn];
    if (!value) continue;
    const organizationId = await resolveOrganizationId(target, row);
    if (!organizationId) {
      console.warn(`${row[target.idColumn]} skipped: no organization`);
      continue;
    }

    const decoded = decodeDataUrl(value);
    const path = `org/${organizationId}/avatars/${target.kind}/${randomUUID()}.${decoded.ext}`;
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
        .from(target.table)
        .update({ [target.valueColumn]: publicUrl })
        .eq(target.idColumn, row[target.idColumn]);
      if (updateError) throw updateError;
    }

    converted += 1;
    console.log(`${row[target.idColumn]} -> ${path}`);
  }
}

console.log(`${dryRun ? "Validated" : "Converted"} ${converted} image(s)`);
