import { createServer } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { apiKeySecretHint, generateApiKeySecret, hashApiKeySecret, sealSecret } from "@agent-hub/core";
import { DEMO_MEMBER, DEMO_ORG, getMockDb } from "@agent-hub/db";
import { decideActionApprovalOp, type OperationContext } from "@ciele/ops";
import { discoverRemoteMcpTools, recordRemoteMcpApprovalOutcome, remoteMcpActions, registerRuntimeHost, streamConversationTurn } from "@agent-hub/agent";
import { POST as mcpPost, GET as mcpGet } from "@/app/api/mcp/route";
import { GET as assistantsGet } from "@/app/api/v1/assistants/route";

// Public runtime -> synthetic HTTP model -> real hosted MCP -> authenticated API -> Db.
const db = getMockDb();
afterEach(() => { registerRuntimeHost({ allowRelaxedEgress: () => false }); vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe("a remote Ciele MCP server on a Teammate turn", () => {
  for (const legacy of [false, true]) it(`connects and reads using the ${legacy ? "legacy" : "modern"} protocol era`, async () => {
    vi.stubEnv("APP_ENCRYPTION_KEY", "synthetic-mcp-integration-key");
    registerRuntimeHost({ allowRelaxedEgress: () => true });
    const token = generateApiKeySecret();
    await db.createApiKey(DEMO_ORG.id, { name: "Remote MCP integration", role: "viewer", roleId: "builtin:viewer", secretHash: hashApiKeySecret(token), secretHint: apiKeySecretHint(token), createdBy: DEMO_MEMBER.userId });
    const observed: string[] = [];
    let origin = "";
    let echoCredential = false;
    let requestedRemote = false;
    const modelRequests: unknown[] = [];
    const server = createServer(async (incoming, outgoing) => {
      try {
        const chunks: Buffer[] = [];
        for await (const chunk of incoming) chunks.push(Buffer.from(chunk));
        const body = Buffer.concat(chunks).toString("utf8");
        const method = incoming.method ?? "GET";
        const headers = new Headers();
        for (const [name, value] of Object.entries(incoming.headers)) if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(", ") : value);
        const request = new Request(`${origin}${incoming.url}`, { method, headers, ...(body ? { body } : {}) });
        const rpc = body ? JSON.parse(body) : null;
        if (incoming.url?.startsWith("/model/")) {
          modelRequests.push(rpc);
          const remote = rpc.tools?.find((tool: { function: { name: string } }) => tool.function.name.startsWith("mcp_") && tool.function.name !== "mcp_read_result");
          const terminal = rpc.tools?.find((tool: { function: { name: string } }) => tool.function.name === "readyToAnswer");
          const call = rpc.tool_choice !== "none" && !requestedRemote && remote
            ? { name: remote.function.name, arguments: JSON.stringify({ action: "list" }) }
            : rpc.tool_choice !== "none" && terminal ? { name: terminal.function.name, arguments: JSON.stringify({ status: "answer" }) } : null;
          if (call?.name === remote?.function.name) requestedRemote = true;
          const delta = call ? { tool_calls: [{ index: 0, id: call.name === remote?.function.name ? "remote-read" : "ready-answer", type: "function", function: call }] } : { content: "Read the Assistant list." };
          const completion = { id: "synthetic-model", object: "chat.completion.chunk", created: 1, model: "synthetic", choices: [{ index: 0, delta, finish_reason: null }] };
          outgoing.writeHead(200, { "content-type": "text/event-stream" });
          outgoing.end(`data: ${JSON.stringify(completion)}\n\ndata: ${JSON.stringify({ ...completion, choices: [{ index: 0, delta: {}, finish_reason: call ? "tool_calls" : "stop" }], usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 } })}\n\ndata: [DONE]\n\n`);
          return;
        }
        if (rpc?.method) observed.push(rpc.method);
        let response: Response;
        if (legacy && rpc?.method === "server/discover") response = Response.json({ jsonrpc: "2.0", id: rpc.id, error: { code: -32601, message: "Method not found" } });
        else if (incoming.url?.startsWith("/api/v1/assistants")) response = await assistantsGet(request);
        else response = await (method === "GET" ? mcpGet : mcpPost)(request);
        if (echoCredential && rpc?.method === "tools/list") {
          const listing = await response.json();
          listing.result.tools[0].description = `Authorization: Bearer ${token}`;
          response = Response.json(listing);
        }
        outgoing.writeHead(response.status, Object.fromEntries(response.headers));
        outgoing.end(Buffer.from(await response.arrayBuffer()));
      } catch (error) { outgoing.writeHead(500).end(String(error)); }
    });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Missing test server address");
      origin = `http://127.0.0.1:${address.port}`;
      vi.stubEnv("CIELE_INTERNAL_API_ORIGIN", origin);
      const tools = await discoverRemoteMcpTools({ url: `${origin}/api/mcp`, token });
      const read = tools.find(tool => tool.name === "manage_assistants");
      if (!read) throw new Error("Ciele did not list its Assistant tool");
      const connection = await db.createMcpServerConnection(DEMO_ORG.id, { name: "Ciele remote", url: `${origin}/api/mcp`, encryptedToken: sealSecret(token), tools: [{ ...read, approvedHash: read.definitionHash, policy: "run_freely", removed: false }] });
      const createdTeammate = await db.table("teammates").insert({ organizationId: DEMO_ORG.id, ownerId: DEMO_MEMBER.userId, name: "Remote Reader", title: "", roleDescription: "Read Assistants", collectionIds: [] });
      const teammate = await db.table("teammates").update(createdTeammate.id, { modelProvider: "openai_compatible", modelId: "synthetic", runtimeConfig: { harness: { kind: "ciele" }, internet: false, computer: { browser: false, files: false, terminal: false }, mcpServerIds: [connection.id] } });
      const actions = await remoteMcpActions({ db, organizationId: DEMO_ORG.id, teammateId: teammate.id, serverIds: [connection.id] });
      const action = actions.find(action => action.label.includes("manage_assistants"));
      if (!action) throw new Error("Remote read tool was omitted");
      const provider = await db.createProviderConnection(DEMO_ORG.id, { type: "api_key", provider: "openai_compatible", config: { kind: "openai_compatible", baseUrl: `${origin}/model/v1`, chatModel: "synthetic", contextWindow: 128000, embeddingModel: "" } });
      const stream = await streamConversationTurn({ db, systemDb: db, teammate, teammateActions: actions, connections: [provider], organizationId: DEMO_ORG.id, subjectType: "member", subjectId: DEMO_MEMBER.userId, keyResolution: { memberId: DEMO_MEMBER.userId, surface: "teammate" }, message: "List Assistants", signal: new AbortController().signal });
      const events = await new Response(stream).text();
      expect(events, JSON.stringify(modelRequests)).toContain("remote-read");
      expect(events).toContain("Ciele remote");
      expect(events).not.toContain(token);
      expect(JSON.stringify(modelRequests)).toContain("untrusted-data");
      expect(JSON.stringify(modelRequests)).not.toContain(token);
      expect(observed).toContain("tools/call");
      expect(observed).toContain(legacy ? "initialize" : "server/discover");
      if (!legacy) {
        await db.compareAndSetMcpTools(DEMO_ORG.id, connection.id, connection.revision, [{ ...read, approvedHash: read.definitionHash, policy: "ask_first", removed: false }]);
        const confirmedActions = await remoteMcpActions({ db, organizationId: DEMO_ORG.id, teammateId: teammate.id, serverIds: [connection.id] });
        const conversation = (await db.listTeammateConversations(teammate.id, DEMO_MEMBER.userId))[0];
        if (!conversation) throw new Error("Missing Teammate Conversation");
        const callsBeforeApproval = observed.filter(method => method === "tools/call").length;
        requestedRemote = false;
        const stopped = await streamConversationTurn({ db, systemDb: db, teammate, teammateActions: confirmedActions, connections: [provider], organizationId: DEMO_ORG.id, subjectType: "member", subjectId: DEMO_MEMBER.userId, keyResolution: { memberId: DEMO_MEMBER.userId, surface: "teammate" }, conversationId: conversation.id, message: "Read again with approval", signal: new AbortController().signal });
        expect(await new Response(stopped).text()).toContain("action_approval");
        expect(observed.filter(method => method === "tools/call")).toHaveLength(callsBeforeApproval);
        const approval = (await db.table("actionApprovals").list({ conversationId: conversation.id, status: "pending" }))[0];
        if (!approval) throw new Error("Missing pending approval");
        const context: OperationContext = { db, organizationId: DEMO_ORG.id, userId: DEMO_MEMBER.userId, role: "owner", ports: {
          runApprovedTeammateAction: async ({ operation, input }) => {
            const current = await remoteMcpActions({ db, organizationId: DEMO_ORG.id, teammateId: teammate.id, serverIds: [connection.id] });
            const tool = current.find(tool => tool.operation === operation);
            if (!tool) throw new Error("MCP policy no longer permits this action");
            return tool.run(input, { confirmed: true });
          },
          afterActionApprovalDecided: async (approval, result) => recordRemoteMcpApprovalOutcome(db, approval.id, result),
        } };
        const decisions = await Promise.allSettled([decideActionApprovalOp.run(context, { id: approval.id, decision: "approved" }), decideActionApprovalOp.run(context, { id: approval.id, decision: "approved" })]);
        expect(decisions.filter(decision => decision.status === "fulfilled")).toHaveLength(1);
        expect(observed.filter(method => method === "tools/call")).toHaveLength(callsBeforeApproval + 1);
        const completed = (await db.listMessages(conversation.id)).at(-1);
        expect(completed?.trace?.steps).toMatchObject([{ label: "Ciele remote: manage_assistants", status: "done" }]);
        requestedRemote = false;
        const refusedTurn = await streamConversationTurn({ db, systemDb: db, teammate, teammateActions: confirmedActions, connections: [provider], organizationId: DEMO_ORG.id, subjectType: "member", subjectId: DEMO_MEMBER.userId, keyResolution: { memberId: DEMO_MEMBER.userId, surface: "teammate" }, conversationId: conversation.id, message: "Ask then decline", signal: new AbortController().signal });
        await new Response(refusedTurn).text();
        expect(JSON.stringify(modelRequests)).toContain(`mcp_approval_${approval.id}`);
        expect(JSON.stringify(modelRequests)).toContain("Approved remote MCP result");
        const refused = (await db.table("actionApprovals").list({ conversationId: conversation.id, status: "pending" }))[0];
        if (!refused) throw new Error("Missing second pending approval");
        await decideActionApprovalOp.run(context, { id: refused.id, decision: "rejected" });
        expect(JSON.stringify((await db.listMessages(conversation.id)).at(-1)?.content)).toContain("was refused. No call was sent.");
        expect(observed.filter(method => method === "tools/call")).toHaveLength(callsBeforeApproval + 1);
        echoCredential = true;
        await expect(discoverRemoteMcpTools({ url: `${origin}/api/mcp`, token })).rejects.toThrow("configured credential in a tool definition");
      }

    } finally {
      server.closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  }, 60_000);
});
