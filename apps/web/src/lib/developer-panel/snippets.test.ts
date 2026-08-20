import { describe, expect, it } from "vitest";
import { roleRank } from "@/lib/rbac";
import {
  buildSnippet,
  capabilityRole,
  pathVariableName,
  renderBodyShape,
  substituteTemplate,
  type SnippetContext,
} from "./snippets";
import type { PanelDomain, PanelOperation } from "./types";

/**
 * The Developer Panel's one new seam (#754). Everything interesting about the
 * panel (which id lands where, what an operation with no CLI verb shows, how a
 * deep request body reads, whose origin the command reaches) is decided here,
 * in a pure function, so it is tested without React (vitest ignores .tsx).
 */

const flowsDomain: PanelDomain = {
  domain: "flows",
  title: "Flows API",
  mcpTool: "manage_flows",
  mcpPrompt: "List the flows on assistant {assistantId} and disable the ones with no conditions.",
  docs: { cli: "/developers/cli", curl: "/developers/api", mcp: "/developers/mcp" },
  operations: [],
};

function operation(overrides: Partial<PanelOperation> = {}): PanelOperation {
  return {
    id: "get /flows/{id}",
    method: "get",
    path: "/flows/{id}",
    summary: "One Flow (full router config)",
    capability: "member",
    idempotent: false,
    cli: "ciele flows get {flowId}",
    mcp: '{"action":"get","id":"{flowId}"}',
    body: null,
    multipart: null,
    ...overrides,
  };
}

function context(overrides: Partial<SnippetContext> = {}): SnippetContext {
  return {
    origin: "https://platform.ciele.app",
    variables: { assistantId: "asst_1", flowId: "flw_9" },
    ...overrides,
  };
}

describe("path variable names", () => {
  it("names an {id} after the resource that owns it", () => {
    expect(pathVariableName("/flows/{id}", "id")).toBe("flowId");
    expect(pathVariableName("/assistants/{id}/flows", "id")).toBe("assistantId");
    expect(pathVariableName("/collections/{id}/sources", "id")).toBe("collectionId");
    expect(pathVariableName("/entities/{id}/records", "id")).toBe("entityId");
  });

  it("camel-cases a hyphenated resource", () => {
    expect(pathVariableName("/help-desks/{id}/channels", "id")).toBe("helpDeskId");
    expect(pathVariableName("/api-keys/{id}", "id")).toBe("apiKeyId");
  });

  it("leaves an already-named parameter alone", () => {
    expect(pathVariableName("/members/{userId}", "userId")).toBe("userId");
    expect(
      pathVariableName("/help-desks/{id}/channels/{channelId}", "channelId")
    ).toBe("channelId");
    expect(
      pathVariableName("/memories/subjects/{subjectId}", "subjectId")
    ).toBe("subjectId");
  });

  it("keeps an irregular plural readable rather than guessing", () => {
    // "-es" and "-ies" are the only two plurals the /api/v1 paths contain;
    // anything else falls back to trimming a single trailing "s".
    expect(pathVariableName("/entities/{id}", "id")).toBe("entityId");
    expect(pathVariableName("/improvements/{id}", "id")).toBe("improvementId");
  });
});

describe("template substitution", () => {
  it("fills the variables the page supplied", () => {
    expect(
      substituteTemplate("ciele flows list {assistantId}", { assistantId: "asst_1" })
    ).toBe("ciele flows list asst_1");
  });

  it("leaves an unsupplied placeholder as itself", () => {
    // The Flows list page knows its Assistant but no single Flow, so
    // {flowId} must survive as an obvious blank to fill in, not as "undefined".
    expect(substituteTemplate("ciele flows get {flowId}", {})).toBe(
      "ciele flows get {flowId}"
    );
  });

  it("substitutes every occurrence", () => {
    expect(
      substituteTemplate("{a} and {a} and {b}", { a: "x", b: "y" })
    ).toBe("x and x and y");
  });
});

describe("CLI snippets", () => {
  it("renders the command with the page's ids", () => {
    const snippet = buildSnippet("cli", operation(), flowsDomain, context());
    expect(snippet.code).toBe("ciele flows get flw_9");
    expect(snippet.unavailable).toBeNull();
  });

  it("says so plainly when no CLI verb covers the operation", () => {
    const snippet = buildSnippet("cli", operation({ cli: null }), flowsDomain, context());
    expect(snippet.code).toBeNull();
    expect(snippet.unavailable).toContain("No CLI command");
  });
});

describe("cURL snippets", () => {
  it("keeps a read to the URL and the key", () => {
    const snippet = buildSnippet("curl", operation(), flowsDomain, context());
    expect(snippet.code).toBe(
      [
        "curl https://platform.ciele.app/api/v1/flows/flw_9 \\",
        '  --header "Authorization: Bearer $CIELE_API_KEY"',
      ].join("\n")
    );
  });

  it("names this deployment's own origin", () => {
    const snippet = buildSnippet(
      "curl",
      operation(),
      flowsDomain,
      context({ origin: "https://ciele.internal.example" })
    );
    expect(snippet.code).toContain("https://ciele.internal.example/api/v1/flows/flw_9");
    expect(snippet.code).not.toContain("platform.ciele.app");
  });

  it("adds the method, content type and body for a write", () => {
    const snippet = buildSnippet(
      "curl",
      operation({
        id: "patch /flows/{id}",
        method: "patch",
        cli: null,
        body: '{\n  "enabled": <boolean>\n}',
      }),
      flowsDomain,
      context()
    );
    expect(snippet.code).toContain("--request PATCH");
    expect(snippet.code).toContain('--header "Content-Type: application/json"');
    expect(snippet.code).toContain("--data '{");
    expect(snippet.code).toContain('"enabled": <boolean>');
  });

  it("uses a form field, not a JSON body, for a multipart endpoint", () => {
    const snippet = buildSnippet(
      "curl",
      operation({
        id: "post /collections/{id}/sources",
        method: "post",
        path: "/collections/{id}/sources",
        multipart: ["file"],
        body: null,
      }),
      flowsDomain,
      context({ variables: { collectionId: "col_2" } })
    );
    expect(snippet.code).toContain("/api/v1/collections/col_2/sources");
    expect(snippet.code).toContain("--form file=@");
    expect(snippet.code).not.toContain("Content-Type: application/json");
  });

  it("substitutes each path parameter by the resource that owns it", () => {
    const snippet = buildSnippet(
      "curl",
      operation({
        id: "get /assistants/{id}/flows",
        path: "/assistants/{id}/flows",
      }),
      flowsDomain,
      context()
    );
    // {id} under /assistants means the Assistant, even though the same token
    // means a Flow under /flows.
    expect(snippet.code).toContain("/api/v1/assistants/asst_1/flows");
  });

  it("leaves an unknown path parameter visible as a placeholder", () => {
    const snippet = buildSnippet(
      "curl",
      operation(),
      flowsDomain,
      context({ variables: {} })
    );
    expect(snippet.code).toContain("/api/v1/flows/{flowId}");
  });
});

describe("MCP snippets", () => {
  it("renders the coarse tool and its substituted arguments", () => {
    const snippet = buildSnippet("mcp", operation(), flowsDomain, context());
    expect(snippet.code).toContain("manage_flows");
    expect(snippet.code).toContain('"action": "get"');
    expect(snippet.code).toContain('"id": "flw_9"');
  });

  it("says so plainly when no tool covers the operation", () => {
    const snippet = buildSnippet("mcp", operation({ mcp: null }), flowsDomain, context());
    expect(snippet.code).toBeNull();
    expect(snippet.unavailable).toContain("No MCP tool");
  });

  it("survives an argument template that is not valid JSON", () => {
    // A hand-authored template is prose until the drift test runs; the panel
    // must show something rather than throw in a user's face.
    const snippet = buildSnippet(
      "mcp",
      operation({ mcp: '{"action":"get",' }),
      flowsDomain,
      context()
    );
    expect(snippet.code).toContain("manage_flows");
  });
});

describe("request-body shapes", () => {
  it("renders top-level properties as typed placeholders", () => {
    const shape = renderBodyShape({
      type: "object",
      properties: {
        name: { type: "string" },
        enabled: { type: "boolean" },
        position: { type: "number" },
      },
    });
    expect(shape).toBe(
      [
        "{",
        '  "name": <string>,',
        '  "enabled": <boolean>,',
        '  "position": <number>',
        "}",
      ].join("\n")
    );
  });

  it("truncates below two levels instead of printing the whole tree", () => {
    const shape = renderBodyShape({
      type: "object",
      properties: {
        name: { type: "string" },
        trigger: {
          type: "object",
          properties: {
            kind: { type: "string" },
            settings: {
              type: "object",
              properties: { minutes: { type: "number" } },
            },
          },
        },
      },
    });
    expect(shape).toContain('"kind": <string>');
    // The third level is elided, not rendered.
    expect(shape).not.toContain("minutes");
    expect(shape).toContain("{ … }");
  });

  it("marks arrays and enums without inventing values", () => {
    const shape = renderBodyShape({
      type: "object",
      properties: {
        orderedIds: { type: "array", items: { type: "string" } },
        status: { enum: ["active", "quarantined"] },
      },
    });
    expect(shape).toContain('"orderedIds": [<string>]');
    expect(shape).toContain('"status": <"active" | "quarantined">');
  });

  it("returns null for a schema with nothing to show", () => {
    expect(renderBodyShape({ type: "object" })).toBeNull();
    expect(renderBodyShape({})).toBeNull();
  });
});

describe("role badges", () => {
  it("names the lowest Role a key needs, from the guards themselves", () => {
    expect(capabilityRole("edit")).toBe("editor");
    expect(capabilityRole("publish")).toBe("admin");
    expect(capabilityRole("manageMembers")).toBe("admin");
    expect(capabilityRole("manageApiKeys")).toBe("admin");
    expect(capabilityRole("changeRoles")).toBe("owner");
  });

  it("agrees with rbac rather than restating it", () => {
    // The point of deriving: a threshold moved in lib/rbac.ts moves the badge.
    for (const capability of ["edit", "publish", "changeRoles"] as const) {
      const role = capabilityRole(capability);
      expect(role).toBeTruthy();
      expect(roleRank(role)).toBeGreaterThan(0);
    }
    expect(roleRank(capabilityRole("edit"))).toBeLessThan(
      roleRank(capabilityRole("changeRoles"))
    );
  });

  it("says nothing for an operation any key may call", () => {
    // A badge on every read would be noise, not information.
    expect(capabilityRole("member")).toBeNull();
  });
});
