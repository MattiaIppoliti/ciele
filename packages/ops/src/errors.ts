/**
 * A caller-attributable failure. `code` maps to an HTTP status on the API
 * surface (not_found → 404, invalid_input → 400, conflict → 409) and to a
 * thrown message on the web surface, operations throw one vocabulary, each
 * surface translates once.
 */
export class OperationError extends Error {
  readonly code: "not_found" | "invalid_input" | "conflict";
  constructor(code: OperationError["code"], message: string) {
    super(message);
    this.name = "OperationError";
    this.code = code;
  }
}
