import { createFieldWorkerRuntime, type FieldWorkerScope, type ToFieldWorker } from "./worker-runtime";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE WORKER ENTRY, AND NOTHING ELSE: `self` IS THE SCOPE.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The host builds it (a bundler has to see `new Worker(new URL(...))` in the
 * host's own code), so this file is what that URL names. See
 * `SurfaceFieldProps.worker`.
 */
/* Typed by hand: the package compiles against the DOM library, and the
   worker library cannot be loaded beside it. */
const scope = self as unknown as FieldWorkerScope & { onmessage: ((event: MessageEvent<ToFieldWorker>) => void) | null };
const runtime = createFieldWorkerRuntime(scope);
scope.onmessage = event => runtime.handle(event.data);
