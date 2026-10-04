import { teammateComputer } from "@agent-hub/agent";
import { getSession } from "@/lib/auth";
import { getDb } from "@/lib/data";
import { findVisibleTeammate } from "@/lib/teammates/access";

type Params = { params: Promise<{ teammateId: string }> };
export const maxDuration = 300;
async function context(params: Params["params"]) {
  const session = await getSession();
  if (!session?.organization)
    return new Response("Unauthorized", { status: 401 });
  const db = await getDb();
  const { teammateId } = await params;
  const teammate = await findVisibleTeammate(
    db,
    session.organization.id,
    teammateId,
    { userId: session.userId, role: session.role },
  );
  if (!teammate || teammate.deletedAt)
    return new Response("Not found", { status: 404 });
  return { session, computer: teammateComputer({ db, teammate }) };
}
export async function GET(request: Request, { params }: Params) {
  const ctx = await context(params);
  if (ctx instanceof Response) return ctx;
  try {
    const query = new URL(request.url).searchParams;
    const view = query.get("view");
    const headers = { "cache-control": "private, no-store" };
    if (view === "screen")
      return Response.json(await ctx.computer.screen(request.signal), {
        headers,
      });
    if (view === "files" || view === "file") {
      const status = await ctx.computer.status();
      if (status.state !== "running")
        return Response.json(
          { error: "Start the computer before reading its workspace." },
          { status: 409, headers },
        );
      return Response.json(
        await ctx.computer.readWorkspace(
          view === "files" ? "files_list" : "files_read",
          { path: query.get("path") ?? "" },
          request.signal,
        ),
        { headers },
      );
    }
    if (view)
      return Response.json(
        { error: "Unknown workspace view" },
        { status: 422, headers },
      );
    return Response.json(
      {
        ...(await ctx.computer.status()),
        canManage: ctx.session.role === "admin" || ctx.session.role === "owner",
      },
      { headers },
    );
  } catch {
    return Response.json(
      { state: "unavailable" },
      { status: 503, headers: { "cache-control": "private, no-store" } },
    );
  }
}
export async function POST(request: Request, { params }: Params) {
  const ctx = await context(params);
  if (ctx instanceof Response) return ctx;
  if (ctx.session.role !== "admin" && ctx.session.role !== "owner")
    return new Response("Admin required", { status: 403 });
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }
  if (
    !body ||
    typeof body !== "object" ||
    !("action" in body) ||
    !["start", "stop"].includes(String(body.action))
  )
    return new Response("Choose start or stop", { status: 422 });
  try {
    return Response.json(
      body.action === "start"
        ? await ctx.computer.start(request.signal)
        : await ctx.computer.stop(),
    );
  } catch {
    return new Response(
      "Computer service unavailable or computer access disabled",
      { status: 503 },
    );
  }
}
