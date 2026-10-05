import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { COMPONENT_FAMILIES, componentFamily } from "@/components/component-catalog/catalog";

// Pre-render only the registered, presentational source files. No caller-supplied
// path is ever read, and production serves the build snapshot without filesystem IO.
export const dynamic = "force-static";
export const dynamicParams = false;
export function generateStaticParams() {
  return COMPONENT_FAMILIES.map(({ slug }) => ({ slug }));
}

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const family = componentFamily((await params).slug);
  if (!family) return Response.json({ error: "Unknown component" }, { status: 404 });
  // Production responses are generated during the build. Do not trace the
  // repository into each source handler's deployment bundle.
  const root = resolve(/* turbopackIgnore: true */ process.cwd(), "../..");
  const files = await Promise.all(
    family.sources.map(async (path) => ({
      path,
      code: await readFile(
        /* turbopackIgnore: true */ resolve(/* turbopackIgnore: true */ root, path),
        "utf8",
      ),
    })),
  );
  return Response.json({ files });
}
