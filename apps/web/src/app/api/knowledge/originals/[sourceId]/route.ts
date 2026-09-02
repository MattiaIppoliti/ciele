import { NextRequest } from "next/server";
import { KNOWLEDGE_ORIGINALS_BUCKET } from "@/lib/storage/assets";
import { serveAdminDownload } from "@/lib/storage/admin-download";

/**
 * Admin download of a file Source's retained original (#801, CYB-05).
 *
 * This replaced a Server Action that handed the browser a ten-minute signed
 * URL and recorded nothing. The URL was the whole authorization: once issued
 * it worked for anyone holding it, and no row anywhere said an original had
 * left the building. A route that streams the bytes can say who asked, from
 * where, and how many bytes actually moved, and it can say so for the
 * refusals too.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ sourceId: string }> }
) {
  const { sourceId } = await params;
  return serveAdminDownload(request, {
    objectKind: "knowledge_original",
    sourceId,
    fallbackPath: `source:${sourceId}`,
    resolve: async (db) => {
      // `getSource` runs on the caller's org-scoped Db, so a foreign id is
      // already null here rather than someone else's file.
      const source = await db.getSource(sourceId);
      if (!source?.originalObjectPath) return null;
      return {
        bucket: KNOWLEDGE_ORIGINALS_BUCKET,
        path: source.originalObjectPath,
        filename: source.name,
      };
    },
  });
}
