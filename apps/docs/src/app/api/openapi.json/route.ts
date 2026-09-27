import { loadOpenApiDocument } from '@/lib/openapi';

export async function GET(request: Request) {
  const document = await loadOpenApiDocument();
  const download = new URL(request.url).searchParams.has('download');
  return new Response(`${JSON.stringify(document, null, 2)}\n`, {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...(download ? { 'Content-Disposition': 'attachment; filename="ciele-openapi.json"' } : {}),
    },
  });
}
