import YAML from 'yaml';
import { loadOpenApiDocument } from '@/lib/openapi';

export async function GET() {
  try {
    const document = await loadOpenApiDocument();
    return new Response(YAML.stringify(document), {
      headers: {
        'Content-Type': 'application/yaml; charset=utf-8',
        'Content-Disposition': 'attachment; filename="ciele-openapi.yaml"',
      },
    });
  } catch {
    return Response.json({ error: 'The API contract is temporarily unavailable.' }, { status: 502 });
  }
}
