import { expect, it } from "vitest";
import { apiKeySecretHint, generateApiKeySecret, hashApiKeySecret } from "@agent-hub/core";
import { DEMO_MEMBER, DEMO_ORG, getMockDb } from "@agent-hub/db";
import { GET, POST } from "@/app/api/v1/roles/route";
import { DELETE, PATCH } from "@/app/api/v1/roles/[roleId]/route";
import { PATCH as PATCH_MEMBER } from "@/app/api/v1/members/[userId]/route";
import { GET as WHOAMI } from "@/app/api/v1/whoami/route";

async function key(role: "owner" | "viewer") {
  const secret = generateApiKeySecret();
  await getMockDb().createApiKey(DEMO_ORG.id, {
    name: `Roles ${role}`,
    role,
    roleId: `builtin:${role}`,
    createdBy: DEMO_MEMBER.userId,
    secretHash: hashApiKeySecret(secret),
    secretHint: apiKeySecretHint(secret),
  });
  return { authorization: `Bearer ${secret}`, "content-type": "application/json" };
}

it("lists, creates, assigns, edits and deletes a Role over /api/v1 (#1164)", async () => {
  const headers = await key("owner");
  const listed = await (await GET(new Request("http://local/api/v1/roles", { headers }))).json();
  expect(listed.data.slice(0, 6).map((role: { key: string }) => role.key)).toEqual(["owner", "admin", "editor", "support_agent", "viewer", "data_viewer"]);

  const created = await POST(new Request("http://local/api/v1/roles", {
    method: "POST",
    headers,
    body: JSON.stringify({ name: "API reviewer", description: "", capabilities: ["knowledge:edit"], organizationLevel: true, assistantLevel: false }),
  }));
  expect(created.status).toBe(201);
  const role = await created.json();
  expect(role.capabilities).toEqual(["knowledge:view", "knowledge:edit"]);

  const member = await PATCH_MEMBER(
    new Request("http://local/api/v1/members/u-marianna", { method: "PATCH", headers, body: JSON.stringify({ roleId: role.id }) }),
    { params: Promise.resolve({ userId: "u-marianna" }) }
  );
  expect(await member.json()).toMatchObject({ roleId: role.id, roleName: "API reviewer" });

  const params = { params: Promise.resolve({ roleId: role.id }) };
  const held = await DELETE(new Request(`http://local/api/v1/roles/${role.id}`, { method: "DELETE", headers }), params);
  expect(held.status).toBe(409);
  await PATCH_MEMBER(
    new Request("http://local/api/v1/members/u-marianna", { method: "PATCH", headers, body: JSON.stringify({ role: "viewer" }) }),
    { params: Promise.resolve({ userId: "u-marianna" }) }
  );
  const renamed = await PATCH(new Request(`http://local/api/v1/roles/${role.id}`, { method: "PATCH", headers, body: JSON.stringify({ name: "API editor" }) }), params);
  expect((await renamed.json()).name).toBe("API editor");
  expect((await DELETE(new Request(`http://local/api/v1/roles/${role.id}`, { method: "DELETE", headers }), params)).status).toBe(204);
});

it("refuses a Viewer key the Role writes, and says what the key may do", async () => {
  const headers = await key("viewer");
  const refused = await POST(new Request("http://local/api/v1/roles", {
    method: "POST",
    headers,
    body: JSON.stringify({ name: "Nope", description: "", capabilities: [], organizationLevel: true, assistantLevel: false }),
  }));
  expect(refused.status).toBe(403);
  expect((await refused.json()).error.message).toContain("roles:manage");
  const identity = await (await WHOAMI(new Request("http://local/api/v1/whoami", { headers }))).json();
  expect(identity.capabilities).toContain("inbox:view");
  expect(identity.capabilities).not.toContain("roles:manage");
});
