import { observe, requestIdFromHeaders, type DiagnosticContext, type DiagnosticOutcome } from "@agent-hub/diagnostics";

/** Callers supply a route template; never derive one from visitor URLs. */
export function requestDiagnosticContext(
  request: Request,
  route: string,
  surface: string
): DiagnosticContext {
  return { requestId: requestIdFromHeaders(request.headers), method: request.method, route, surface };
}

/** Returning a handled error response must not produce a success record. */
export function responseDiagnosticOutcome(response: Response): DiagnosticOutcome {
  return {
    status: response.status >= 500 ? "failed" : response.status >= 400 ? "rejected" : "succeeded",
    statusCode: response.status,
  };
}

/** Measures dispatch to response headers; never reads or buffers stream bodies. */
export function withRequestDiagnostics<Args extends [Request, ...unknown[]]>(
  route: string,
  surface: string,
  handler: (...args: Args) => Promise<Response>
): (...args: Args) => Promise<Response> {
  return (...args) => observe({
    name: "http.request",
    context: requestDiagnosticContext(args[0], route, surface),
    outcome: responseDiagnosticOutcome,
  }, () => handler(...args));
}
