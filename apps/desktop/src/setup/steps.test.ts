import { describe, expect, it } from "vitest";
import { createSetupEngine } from "./engine";
import { parseEnvFile } from "./secrets";
import { BAG, SETUP_STEPS } from "./steps";
import { fakePorts, type FakePortOptions, type FakePorts } from "./testing/fake-ports";
import { FAKE_ENV_TEMPLATE as ENV_TEMPLATE } from "./testing/env-template";
import type { SetupConfig } from "./ports";

const CONFIG: SetupConfig = {
  dataDir: "/data",
  deployDir: "/deploy",
  imageTag: "v1.2.3",
  appUrl: "http://localhost:3000",
  supabaseUrl: "http://localhost:8000",
  dockerDownloadUrl: "https://example.invalid/docker",
  composePathSeparator: ":",
};

function harness(options: FakePortOptions = {}) {
  const ports: FakePorts = fakePorts({
    files: { "/deploy/.env.example": ENV_TEMPLATE, ...options.files },
    ...options,
  });
  return { ports, engine: createSetupEngine({ steps: SETUP_STEPS, ports, config: CONFIG }) };
}

describe("the happy path", () => {
  it("runs the required chain unattended and stops to ask about the first choice", async () => {
    const { engine, ports } = harness();

    const snapshot = await engine.run();

    expect(snapshot.steps.slice(0, 5).map((s) => s.status)).toEqual([
      "done",
      "done",
      "done",
      "done",
      "done",
    ]);
    expect(snapshot.awaitingDecision).toBe(true);
    expect(snapshot.steps[snapshot.currentIndex]!.id).toBe("seed");
    // Pull before start: an out-of-order stack is one that starts from images
    // it has not downloaded.
    expect(ports.composeCalls[0]).toContain("pull");
    expect(ports.composeCalls[1]).toContain("up -d");
  });

  it("reaches a running stack with both choices declined", async () => {
    const { engine } = harness();

    await engine.run();
    await engine.skip(); // demo content
    const snapshot = await engine.skip(); // AI model

    expect(snapshot.complete).toBe(true);
    expect(snapshot.steps.map((s) => s.status)).toEqual([
      "done",
      "done",
      "done",
      "done",
      "done",
      "skipped",
      "skipped",
      "done",
    ]);
  });

  it("writes a complete env file the user never has to open", async () => {
    const { engine, ports } = harness();

    await engine.run();
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
  });

  it("pins the stack to this build's image tag, so no source build is needed", async () => {
    const { engine, ports } = harness();

    await engine.run();
    const env = parseEnvFile(ports.files.get("/data/.env")!);

    expect(env.CIELE_IMAGE_TAG).toBe("v1.2.3");
    expect(env.COMPOSE_FILE).toBe("docker-compose.yml:docker-compose.images.yml");
  });

  it("joins COMPOSE_FILE with the platform's separator, not a hardcoded colon", async () => {
    // Compose splits COMPOSE_FILE on `;` on Windows — a colon there would glue
    // both filenames into one that does not exist. The engine stays platform
    // blind: the separator arrives through the config, like everything else.
    const ports = fakePorts({ files: { "/deploy/.env.example": ENV_TEMPLATE } });
    const engine = createSetupEngine({
      steps: SETUP_STEPS,
      ports,
      config: { ...CONFIG, composePathSeparator: ";" },
    });

    await engine.run();
    const env = parseEnvFile(ports.files.get("/data/.env")!);

    expect(env.COMPOSE_FILE).toBe("docker-compose.yml;docker-compose.images.yml");
  });

  it("runs every compose command against the bundled definition and generated env", async () => {
    const { engine, ports } = harness();

    await engine.run();

    for (const call of ports.composeCalls) {
      expect(call).toContain("--env-file /data/.env");
      expect(call).toContain("-f /deploy/docker-compose.yml");
      expect(call).toContain("-f /deploy/docker-compose.images.yml");
    }
  });
});

describe("the Docker prerequisite", () => {
  it("says install it, with a link, when it is not there", async () => {
    const { engine } = harness({ dockerInstalled: false });

    const snapshot = await engine.run();

    expect(snapshot.steps[0]!.status).toBe("failed");
    expect(snapshot.steps[0]!.error).toMatch(/not installed/);
    expect(snapshot.steps[0]!.help).toEqual({
      label: "Get Docker Desktop",
      url: CONFIG.dockerDownloadUrl,
    });
    // The walkthrough is for someone who has never installed developer
    // tooling: it starts from the button in this window and ends on the
    // button that re-checks.
    const guide = snapshot.steps[0]!.guide;
    expect(guide.length).toBeGreaterThanOrEqual(3);
    expect(guide[0]).toContain("Get Docker Desktop");
    expect(guide.at(-1)).toContain("Try again");
  });

  it("says start it — a different problem — when it is installed but stopped", async () => {
    const { engine } = harness({ dockerRunning: false });

    const snapshot = await engine.run();

    expect(snapshot.steps[0]!.error).toMatch(/not running/);
    expect(snapshot.steps[0]!.help).toBeNull();
    // A different journey than "install it": no download, just open and wait.
    const guide = snapshot.steps[0]!.guide;
    expect(guide[0]).toContain("Open Docker Desktop");
    expect(guide.at(-1)).toContain("Try again");
  });

  it("nothing runs against Docker until that check passes", async () => {
    const { engine, ports } = harness({ dockerInstalled: false });

    await engine.run();

    expect(ports.composeCalls).toEqual([]);
    expect(ports.files.has("/data/.env")).toBe(false);
  });

  it("re-checking in place is all it takes once Docker is started", async () => {
    // The user's fix happens outside the app, so retry has to be a real
    // re-check rather than a replay of a cached answer.
    let running = false;
    const ports = fakePorts({ files: { "/deploy/.env.example": ENV_TEMPLATE } });
    ports.docker.isRunning = async () => running;
    const engine = createSetupEngine({ steps: SETUP_STEPS, ports, config: CONFIG });

    await engine.run();
    expect(engine.snapshot().steps[0]!.status).toBe("failed");

    running = true;
    const snapshot = await engine.retry();

    expect(snapshot.steps[0]!.status).toBe("done");
    expect(snapshot.steps.find((s) => s.id === "migrate")!.status).toBe("done");
  });
});

describe("an unreleased build", () => {
  it("says which images it cannot find instead of failing at the registry", async () => {
    // Only the release workflow stamps a version. Everything else — a
    // contributor build, a CI artifact — has no published images to pin, and
    // pinning one anyway turns into an unexplained pull failure.
    const ports = fakePorts({ files: { "/deploy/.env.example": ENV_TEMPLATE } });
    const engine = createSetupEngine({
      steps: SETUP_STEPS,
      ports,
      config: { ...CONFIG, imageTag: null },
    });

    const snapshot = await engine.run();
    const pull = snapshot.steps.find((s) => s.id === "pull")!;

    expect(pull.status).toBe("failed");
    expect(pull.error).toMatch(/CIELE_IMAGE_TAG/);
    expect(ports.composeCalls.some((call) => call.includes("pull"))).toBe(false);
  });
});

describe("existing installations", () => {
  it("never regenerates secrets over an existing installation", async () => {
    // Doing so would lock the user out of their own database: the data on
    // disk is signed and sealed with the secrets already in that file.
    const existing = [
      "POSTGRES_PASSWORD=keepme",
      "JWT_SECRET=keepme-too",
      "ANON_KEY=a",
      "SERVICE_ROLE_KEY=s",
      "APP_ENCRYPTION_KEY=e",
      "CRON_SECRET=c",
    ].join("\n");
    const { engine, ports } = harness({ files: { "/data/.env": existing } });

    await engine.run();

    expect(ports.files.get("/data/.env")).toContain("POSTGRES_PASSWORD=keepme");
    expect(ports.files.get("/data/.env")).toContain("JWT_SECRET=keepme-too");
  });
});

describe("failure and retry through the real steps", () => {
  it("surfaces a failed image pull with its logs, and recovers on retry", async () => {
    const { engine } = harness({ failOnce: ["pull"] });

    const failed = await engine.run();
    const pull = failed.steps.find((s) => s.id === "pull")!;

    expect(pull.status).toBe("failed");
    expect(pull.error).toMatch(/Could not download the images/);
    expect(pull.logs.join("\n")).toContain("simulated failure");
    // Nothing downstream ran.
    expect(failed.steps.find((s) => s.id === "start")!.status).toBe("pending");

    const recovered = await engine.retry();

    expect(recovered.steps.find((s) => s.id === "pull")!.status).toBe("done");
    expect(recovered.steps.find((s) => s.id === "migrate")!.status).toBe("done");
  });

  it("does not call the stack healthy while it is still coming up", async () => {
    const ports = fakePorts({ files: { "/deploy/.env.example": ENV_TEMPLATE } });
    ports.probe.get = async () => null;
    const engine = createSetupEngine({ steps: SETUP_STEPS, ports, config: CONFIG });

    const snapshot = await engine.run();

    const start = snapshot.steps.find((s) => s.id === "start")!;
    expect(start.status).toBe("failed");
    expect(start.error).toMatch(/not answering/);
  });
});

describe("the optional steps", () => {
  it("never loads demo content into an install that did not ask for it", async () => {
    // "Optional" that happens to you anyway is not optional.
    const { engine, ports } = harness();

    await engine.run();

    expect(engine.snapshot().awaitingDecision).toBe(true);
    expect(ports.composeCalls.some((call) => call.includes("LOAD_DEMO_SEED"))).toBe(false);
  });

  it("recovers from a failed demo seed by skipping it", async () => {
    const { engine, ports } = harness({ failOnce: ["LOAD_DEMO_SEED=1"] });

    await engine.run();
    await engine.run(); // the user accepts the demo content, and it fails
    expect(engine.snapshot().steps.find((s) => s.id === "seed")!.status).toBe("failed");

    await engine.skip();
    const snapshot = await engine.skip(); // and declines the model step too

    expect(snapshot.complete).toBe(true);
    expect(snapshot.steps.find((s) => s.id === "seed")!.status).toBe("skipped");
    expect(snapshot.steps.find((s) => s.id === "done")!.status).toBe("done");
    expect(ports.composeCalls.some((call) => call.includes("LOAD_DEMO_SEED"))).toBe(true);
  });

  it("verifies the demo content against the database, not the seed run's exit code", async () => {
    const { engine, ports } = harness();

    await engine.run();
    const snapshot = await engine.run(); // the user accepts the demo content

    expect(snapshot.steps.find((s) => s.id === "seed")!.status).toBe("done");
    expect(
      ports.composeCalls.some((call) => call.includes("select count(*) from public.assistants")),
    ).toBe(true);
  });

  it("refuses an empty model address rather than writing a broken config", async () => {
    const { engine, ports } = harness();

    await engine.run();
    await engine.skip(); // no demo content
    const snapshot = await engine.run(); // accept the model step, having typed nothing

    const model = snapshot.steps.find((s) => s.id === "model")!;
    expect(model.status).toBe("failed");
    expect(model.error).toMatch(/Enter a model server address, or skip/);
    expect(parseEnvFile(ports.files.get("/data/.env")!).OPENAI_COMPATIBLE_BASE_URL).toBe("");
  });

  it("writes the model settings and restarts the app when given one", async () => {
    const { engine, ports } = harness();

    await engine.run();
    await engine.skip();
    engine.setInput("model", {
      baseUrl: "http://host.docker.internal:11434/v1",
      chatModel: "llama3.1:8b",
      embeddingModel: "nomic-embed-text",
    });
    const snapshot = await engine.run();

    expect(snapshot.complete).toBe(true);
    const env = parseEnvFile(ports.files.get("/data/.env")!);
    expect(env.OPENAI_COMPATIBLE_BASE_URL).toBe("http://host.docker.internal:11434/v1");
    expect(env.OPENAI_COMPATIBLE_CHAT_MODEL).toBe("llama3.1:8b");
    expect(ports.composeCalls.at(-1)).toContain("up -d app");
  });

  it("never writes the API key into a log line", async () => {
    const { engine } = harness();

    await engine.run();
    await engine.skip();
    engine.setInput("model", { baseUrl: "https://api.example.invalid/v1", apiKey: "sk-secret" });
    const snapshot = await engine.run();

    const everyLog = snapshot.steps.flatMap((s) => s.logs).join("\n");
    expect(everyLog).not.toContain("sk-secret");
  });
});

describe("the step list itself", () => {
  it("is the order the wizard promises", () => {
    expect(SETUP_STEPS.map((s) => s.id)).toEqual([
      "docker",
      "secrets",
      "pull",
      "start",
      "migrate",
      "seed",
      "model",
      "done",
    ]);
  });

  it("marks as optional exactly the steps a working install can do without", () => {
    expect(SETUP_STEPS.filter((s) => s.optional).map((s) => s.id)).toEqual(["seed", "model"]);
  });

  it("leaves the env path in the bag for the host to use afterwards", async () => {
    const { engine } = harness();
    await engine.run();
    expect(engine.bag()[BAG.envPath]).toBe("/data/.env");
  });

  it("every required step is reached without a single decision from the user", async () => {
    const { engine } = harness();

    const snapshot = await engine.run();

    const required = SETUP_STEPS.filter((s) => !s.optional && s.id !== "done").map((s) => s.id);
    for (const id of required) {
      expect(snapshot.steps.find((s) => s.id === id)!.status, id).toBe("done");
    }
  });
});
