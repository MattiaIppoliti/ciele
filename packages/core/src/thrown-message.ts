/** PostgREST failures surface as plain objects with a `message`, not Error
 *  instances — read it before falling back so admins see the real cause. */
export function thrownMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) return error.message;
  if (
    error &&
    typeof error === "object" &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return error.message;
  }
  return fallback;
}
