import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { deriveResponseSchemas } from './response-schemas';

async function main() {
  const responses = fileURLToPath(new URL('../src/lib/api-v1/response-schemas.generated.json', import.meta.url));
  writeFileSync(responses, `${JSON.stringify(deriveResponseSchemas(), null, 2)}\n`);
  const { buildOpenApiDocument } = await import('../src/lib/api-v1/openapi');
  const output = fileURLToPath(new URL('../../docs/src/lib/openapi.generated.json', import.meta.url));
  writeFileSync(output, `${JSON.stringify(buildOpenApiDocument(), null, 2)}\n`);
  console.log(`Wrote ${responses} and ${output}`);
}

void main();
