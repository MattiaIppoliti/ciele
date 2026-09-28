/**
 * A memory document changed between the read a writer based its new body on
 * and the write itself. The body is a whole document, not a patch, so writing
 * anyway would erase the other writer's change from the document and, because
 * history keeps only the body before each write, from its history as well.
 * The caller re-reads and decides again.
 */
export class MemoryDocumentConflictError extends Error {
  constructor() {
    super("This memory document changed since it was read. Reload it and try again.");
    this.name = "MemoryDocumentConflictError";
  }
}
