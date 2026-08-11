// Pins the fake env template to the real one.
//
// The fake exists so the smoke and the engine tests can run without the
// bundled deploy assets — which also means nothing in that path ever reads
// `deploy/.env.example`. Without these two tests, the fake and the real file
// drift apart in silence: a key renamed or added there would still pass every
// fake-backed check and only fail on a user's machine.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createSetupEngine } from "../engine";
import { parseEnvFile } from "../secrets";
import { SETUP_STEPS } from "../steps";
import { fakePorts } from "./fake-ports";
import { FAKE_ENV_TEMPLATE } from "./env-template";
import type { SetupConfig } from "../ports";

const REAL_TEMPLATE = readFileSync(
  fileURLToPath(new URL("../../../../../deploy/.env.example", import.meta.url)),
  "utf8",
);

const CONFIG: SetupConfig = {
  dataDir: "/data",
  deployDir: "/deploy",
  imageTag: "v1.2.3",
  appUrl: "http://localhost:3000",
  supabaseUrl: "http://localhost:8000",
  dockerDownloadUrl: "https://example.invalid/docker",
};

describe("the fake env template", () => {
  it("only contains keys the real deploy/.env.example has", () => {
    const real = parseEnvFile(REAL_TEMPLATE);
    for (const key of Object.keys(parseEnvFile(FAKE_ENV_TEMPLATE))) {
      expect(real, key).toHaveProperty(key);
    }
  });

  it("the wizard completes against the real template's contents, not just the fake's", async () => {
    const ports = fakePorts({ files: { "/deploy/.env.example": REAL_TEMPLATE } });
    const engine = createSetupEngine({ steps: SETUP_STEPS, ports, config: CONFIG });

    await engine.run();
    await engine.skip(); // demo content
    const snapshot = await engine.skip(); // AI model

    expect(snapshot.complete).toBe(true);
    const env = parseEnvFile(ports.files.get("/data/.env")!);
    for (const key of [
      "POSTGRES_PASSWORD",
      "JWT_SECRET",
      "ANON_KEY",
      "SERVICE_ROLE_KEY",
      "APP_ENCRYPTION_KEY",
      "CRON_SECRET",
    ]) {
      expect(env[key], key).toBeTruthy();
    }
    expect(env.COMPOSE_FILE).toBe("docker-compose.yml:docker-compose.images.yml");
    expect(env.CIELE_IMAGE_TAG).toBe("v1.2.3");
  });
});
