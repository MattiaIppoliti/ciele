import { describe, expect, it } from "vitest";
import {
  TEMPLATE_VARIABLES,
  buildTemplateContext,
  resolveTemplate,
} from "./template";

const FULL = buildTemplateContext({
  user: { name: "Ada Lovelace", email: "ada@example.com", id: "user-7" },
  workflowName: "Escalation",
  message: "I need a refund",
  history: [
    { role: "user", text: "Hi" },
    { role: "assistant", text: "Hello — how can I help?" },
  ],
  conversationId: "conv-42",
  appOrigin: "https://platform.example",
  metadata: {
    launchUrl: "https://shop.example/cart",
    ip: "203.0.113.7",
    browser: "Chrome",
    os: "macOS",
    resolution: "1470x923",
    language: "en-US",
    location: "IT",
    city: "Rome",
  },
});

describe("resolveTemplate — catalog", () => {
  it.each([
    ["{{user.name}}", "Ada Lovelace"],
    ["{{user.email}}", "ada@example.com"],
    ["{{user.id}}", "user-7"],
    ["{{workflow.name}}", "Escalation"],
    ["{{workflow.message}}", "I need a refund"],
    [
      "{{conversation.link}}",
      "https://platform.example/inbox/conversations/conv-42",
    ],
    ["{{conversation.metadata.launch_url}}", "https://shop.example/cart"],
    ["{{conversation.metadata.ip_address}}", "203.0.113.7"],
    ["{{conversation.metadata.browser}}", "Chrome"],
    ["{{conversation.metadata.os}}", "macOS"],
    ["{{conversation.metadata.resolution}}", "1470x923"],
    ["{{conversation.metadata.language}}", "en-US"],
    ["{{conversation.metadata.country}}", "IT"],
    ["{{conversation.metadata.city}}", "Rome"],
  ])("resolves %s", (token, expected) => {
    expect(resolveTemplate(token, FULL)).toBe(expected);
  });

  it("renders conversation.history as a bounded plain-text transcript", () => {
    expect(resolveTemplate("{{conversation.history}}", FULL)).toBe(
      "User: Hi\nAssistant: Hello — how can I help?"
    );
  });

  it("resolves tokens embedded in surrounding text and repeats", () => {
    expect(
      resolveTemplate("Hi {{user.name}} ({{user.name}})", FULL)
    ).toBe("Hi Ada Lovelace (Ada Lovelace)");
  });
});

describe("resolveTemplate — missing values", () => {
  const empty = buildTemplateContext({
    conversationId: "conv-1",
    appOrigin: "https://platform.example",
  });

  it("renders an unresolved catalog variable as an empty string", () => {
    expect(resolveTemplate("[{{user.name}}]", empty)).toBe("[]");
    expect(resolveTemplate("[{{conversation.metadata.city}}]", empty)).toBe(
      "[]"
    );
  });

  it("leaves an unknown token untouched (not a catalog variable)", () => {
    expect(resolveTemplate("{{course.name}}", FULL)).toBe("{{course.name}}");
    expect(resolveTemplate("{{session.id}}", FULL)).toBe("{{session.id}}");
    expect(resolveTemplate("{{ user.name }}", FULL)).toBe("{{ user.name }}");
  });

  it("resolves a non-catalog token when the context carries it (JSON-path extractions)", () => {
    expect(resolveTemplate("id {{userName}}", { userName: "Ada" })).toBe("id Ada");
    // still verbatim when neither catalog nor context has it
    expect(resolveTemplate("{{missing}}", { userName: "Ada" })).toBe("{{missing}}");
  });
});

describe("resolveTemplate — per-slot escaping", () => {
  const ctx = buildTemplateContext({
    user: { name: 'a/b c&d="e"', id: "x\r\ny" },
    message: 'line1\nline2 "quoted" \\path',
    conversationId: "c",
    appOrigin: "https://p.example",
  });

  it("plain (default) does not escape", () => {
    expect(resolveTemplate("{{user.name}}", ctx)).toBe('a/b c&d="e"');
  });

  it("url-component encodes for path/query slots", () => {
    expect(resolveTemplate("{{user.name}}", ctx, "url-component")).toBe(
      "a%2Fb%20c%26d%3D%22e%22"
    );
  });

  it("header strips CR/LF/NUL", () => {
    expect(resolveTemplate("{{user.id}}", ctx, "header")).toBe("xy");
  });

  it("json-string escapes quotes, backslashes and control chars", () => {
    // Safe to splice into a JSON string literal: "...".
    const escaped = resolveTemplate("{{workflow.message}}", ctx, "json-string");
    expect(JSON.parse(`"${escaped}"`)).toBe('line1\nline2 "quoted" \\path');
  });
});

describe("TEMPLATE_VARIABLES catalog", () => {
  it("is the single source every surface consumes — every entry resolves", () => {
    for (const variable of TEMPLATE_VARIABLES) {
      expect(variable.token).toMatch(/^\{\{[a-z0-9_.]+\}\}$/);
      expect(variable.description.length).toBeGreaterThan(0);
      // A catalog token must be a real resolvable variable, not literal passthrough.
      expect(resolveTemplate(variable.token, FULL)).not.toBe(variable.token);
    }
  });

  it("excludes the deferred and out-of-scope variables", () => {
    const tokens = TEMPLATE_VARIABLES.map((v) => v.token);
    expect(tokens).not.toContain("{{conversation.summary}}");
    expect(tokens).not.toContain("{{course.name}}");
    expect(tokens).not.toContain("{{course.id}}");
    expect(tokens).not.toContain("{{session.id}}");
  });

  it("uses industry-neutral descriptions (no education-specific terms)", () => {
    for (const { description } of TEMPLATE_VARIABLES) {
      expect(description).not.toMatch(/student|university|campus|course/i);
    }
  });
});
