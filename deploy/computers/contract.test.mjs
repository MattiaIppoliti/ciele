import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { hardenSupervisorEnvironment } from "./harden-supervisor.mjs";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
const source =
  "function environmentFor(botId, env) { const computerToken = env.COMPUTER_TOKEN?.trim() || undefined; return computerToken; }";
const hardened = hardenSupervisorEnvironment(source);
// Execute the authentication patch against two independent computers.
const evaluate = new Function(
  "createHmac",
  hardened.replace('import { createHmac } from "node:crypto";', "") +
    "; return environmentFor;",
)(createHmac);
const master = "fixture-master-secret-with-at-least-24-characters";
assert.notEqual(evaluate("first", { COMPUTER_TOKEN: master }), master);
assert.notEqual(
  evaluate("first", { COMPUTER_TOKEN: master }),
  evaluate("second", { COMPUTER_TOKEN: master }),
);
assert.equal(
  evaluate("first", { COMPUTER_TOKEN: master }),
  createHmac("sha256", master).update("ciele-computer:first").digest("hex"),
);
assert.throws(() => evaluate("first", { COMPUTER_TOKEN: "short" }));
assert.throws(() =>
  hardenSupervisorEnvironment(source.replace("?.trim()", "")),
);
console.log("Computer authentication contract passed.");

// A real Compose parse/merge needs its CLI, but not a running Docker daemon.
const scratch = mkdtempSync(path.join(tmpdir(), "ciele-computer-compose-"));
try {
  const envFile = path.join(scratch, "fixture.env");
  const teammateEnv = path.join(scratch, "teammates.env");
  writeFileSync(
    teammateEnv,
    "CIELE_CHAT_CONNECTIONS=[]\nCIELE_AG_UI_HARNESSES=[]\n",
  );
  writeFileSync(
    envFile,
    [
      "POSTGRES_PASSWORD=fixture-password",
      "JWT_SECRET=fixture-jwt-secret",
      "ANON_KEY=fixture-anon",
      "SERVICE_ROLE_KEY=fixture-service",
      "APP_ENCRYPTION_KEY=fixture-encryption",
      "CRON_SECRET=fixture-cron",
      `CIELE_COMPUTER_TOKEN=${master}`,
      "CIELE_COMPUTER_SUPERVISOR_TOKEN=fixture-distinct-supervisor-secret",
      `CIELE_TEAMMATE_ENV_FILE=${teammateEnv}`,
      "COMPOSE_PROFILES=db,migrate,app,cron",
    ].join("\n"),
  );
  const flags = [
    "--env-file",
    envFile,
    ...[
      "docker-compose.yml",
      "docker-compose.computers.yml",
      "docker-compose.computers-app.yml",
      "docker-compose.teammate-messaging.yml",
    ].flatMap((file) => ["-f", path.join(root, "deploy", file)]),
    "config",
    "--format",
    "json",
  ];
  let output;
  try {
    output = execFileSync("docker", ["compose", ...flags], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch {
    output = execFileSync("docker-compose", flags, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  }
  const compose = JSON.parse(output);
  const app = compose.services.app;
  for (const name of [
    "backend",
    "workers",
    "computer-control",
    "computers",
    "teammate-messaging",
  ])
    assert.ok(Object.hasOwn(app.networks, name));
  assert.ok(!compose.services["computer-supervisor"].ports?.length);
  assert.ok(!compose.services["teammate-chat-state"].ports?.length);
  assert.equal(compose.networks["computer-control"].internal, true);
  assert.equal(
    compose.services["computer-supervisor"].environment.COMPUTER_NETWORK,
    "ciele-computers",
  );
  assert.equal(
    app.environment.CIELE_COMPUTER_SUPERVISOR_URL,
    "http://computer-supervisor:4300",
  );
  assert.equal(app.environment.CIELE_CHAT_CONNECTIONS, "[]");
  assert.equal(
    app.environment.CIELE_CHAT_REDIS_URL,
    "redis://teammate-chat-state:6379",
  );
  assert.equal(
    compose.services["computer-supervisor"].build.additional_contexts.openbot,
    "https://github.com/CopilotKit/OpenBot.git#b6932d31a8d6e7896c15139dfc27a6c6911deb27",
  );
  const image = readFileSync(
    path.join(root, "deploy/computers/supervisor.Dockerfile"),
    "utf8",
  );
  assert.ok(
    image.includes("harden-supervisor.mjs") &&
      image.includes("LICENSE.openbot") &&
      image.includes("LICENSE.opendots"),
  );
  console.log("Computer and messaging Compose merge passed.");
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
