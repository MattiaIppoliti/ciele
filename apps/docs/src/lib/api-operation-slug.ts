/** Stable, readable file name for an OpenAPI operation within its domain. */
export function apiOperationSlug(method: string, path: string): string {
  const resource = path
    .replace(/^\/api\/v1\/?/, '')
    .replace(/[{}]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();
  return `${method.toLowerCase()}-${resource}`;
}
