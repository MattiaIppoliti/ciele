import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { fillEnvTemplate, generateStackSecrets, parseEnvFile } from "./secrets";
import { fakePorts } from "./testing/fake-ports";

function generate() {
  const ports = fakePorts();
  return generateStackSecrets(ports.crypto, ports.clock);
}

describe("generateStackSecrets", () => {
  it("produces every secret the stack refuses to start without", () => {
    const secrets = generate();
    for (const [name, value] of Object.entries(secrets)) {
      expect(value, name).toBeTruthy();
    }
  });

  it("never reuses one secret for two purposes", () => {
    // Reusing one would tie unrelated compromises together: the cron bearer
    // token and the key sealing provider credentials must fall separately.
    const { postgresPassword, jwtSecret, appEncryptionKey, cronSecret } = generate();
    const distinct = new Set([postgresPassword, jwtSecret, appEncryptionKey, cronSecret]);
    expect(distinct.size).toBe(4);
  });

  it("signs both API keys with this install's own JWT secret", () => {
    // This is the failure that is hardest to diagnose in the wild: a wrongly
    // signed key gives a stack that starts cleanly and then 401s everything.
    const secrets = generate();
    for (const [key, role] of [
      [secrets.anonKey, "anon"],
      [secrets.serviceRoleKey, "service_role"],
    ] as const) {
      const [header, payload, signature] = key.split(".");
      expect(signature).toBe(
        createHmac("sha256", secrets.jwtSecret)
          .update(`${header}.${payload}`)
          .digest("base64url"),
      );
      const claims = JSON.parse(Buffer.from(payload!, "base64url").toString());
      expect(claims.role).toBe(role);
      expect(JSON.parse(Buffer.from(header!, "base64url").toString()).alg).toBe("HS256");
    }
  });

  it("gives the API keys a lifetime measured in years, not hours", () => {
    // Rotating them means rotating JWT_SECRET, which is a deliberate
    // operation — not something a self-hoster should hit by surprise.
    const { anonKey } = generate();
    const claims = JSON.parse(Buffer.from(anonKey.split(".")[1]!, "base64url").toString());
    expect(claims.exp - claims.iat).toBeGreaterThan(31_536_000);
  });

  it("makes the encryption key exactly the 32 bytes AES-256 needs", () => {
    expect(Buffer.from(generate().appEncryptionKey, "base64")).toHaveLength(32);
  });

  it("keeps the Postgres password safe inside a connection string", () => {
    // It is interpolated into the userinfo section of the database URL, where
    // a stray @, :, / or whitespace silently truncates the URL.
    expect(generate().postgresPassword).not.toMatch(/[@:/#?\s]/);
  });

  it("emits base64url with no padding, which is what a JWT segment is", () => {
    const { anonKey } = generate();
    expect(anonKey).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  });
});

describe("fillEnvTemplate", () => {
  const template = [
    "# Generated secrets",
    "POSTGRES_PASSWORD=",
    "JWT_SECRET=",
    "# Where it is reachable",
    "APP_PORT=3000",
    "PLATFORM_OWNER_EMAIL=",
  ].join("\n");

  it("fills the empty keys and leaves everything else exactly as it was", () => {
    const filled = fillEnvTemplate(template, { POSTGRES_PASSWORD: "pw", JWT_SECRET: "js" });

    expect(filled.split("\n")).toEqual([
      "# Generated secrets",
      "POSTGRES_PASSWORD=pw",
      "JWT_SECRET=js",
      "# Where it is reachable",
      "APP_PORT=3000",
      "PLATFORM_OWNER_EMAIL=",
    ]);
  });

  it("never overwrites a key that already has a value", () => {
    // Re-running setup must not replace a secret: the data that secret
    // protects would be orphaned by it.
    expect(fillEnvTemplate("APP_PORT=3000", { APP_PORT: "9999" })).toBe("APP_PORT=3000");
  });

  it("leaves a key alone when there is no value for it", () => {
    expect(fillEnvTemplate(template, {})).toBe(template);
  });

  it("round-trips through parseEnvFile", () => {
    const values = { POSTGRES_PASSWORD: "pw", JWT_SECRET: "js" };
    expect(parseEnvFile(fillEnvTemplate(template, values))).toMatchObject({
      ...values,
      APP_PORT: "3000",
      PLATFORM_OWNER_EMAIL: "",
    });
  });

  it("ignores comments and blank lines when reading back", () => {
    expect(parseEnvFile("# a comment\n\nKEY=value\nnot a line\n")).toEqual({ KEY: "value" });
  });
});
