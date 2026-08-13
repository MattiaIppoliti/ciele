// The wizard, as data.
//
// Docker check → data directory + secrets → pull images → start the stack →
// migrations + health → optional demo seed → optional AI model → done.
//
// Every step is `execute` then `verify`, and only a passing verify unlocks the
// next one. The verifies are the interesting half: `docker compose up` exits 0
// long before anything is serving, so "the command succeeded" proves almost
// nothing and each step has to go and look.

import { composeArgs } from "./compose";
import { fillEnvTemplate, generateStackSecrets, parseEnvFile } from "./secrets";
import type { SetupStep, StepContext } from "./types";

/** Keys the steps leave in the bag for each other. */
export const BAG = {
  envPath: "envPath",
  seeded: "seeded",
  modelConfigured: "modelConfigured",
} as const;

/** Health endpoint the stack's gateway serves once the database layer is up. */
const GATEWAY_HEALTH_PATH = "/auth/v1/health";

async function runCompose(
  context: StepContext,
  args: readonly string[],
  failureMessage: string,
): Promise<void> {
  const result = await context.ports.docker.compose(composeArgs(context.config, args), (chunk) => {
    for (const line of chunk.split("\n")) if (line.trim()) context.log(line);
  });
  if (result.code !== 0) throw new Error(failureMessage);
}

export const dockerStep: SetupStep = {
  id: "docker",
  title: "Docker Desktop",
  description:
    "The only thing you install yourself. Ciele runs its database and background jobs in containers.",
  // Nothing to do — this step is a check, and re-running it is the re-check
  // button the user needs when they have just started Docker Desktop.
  execute: async () => {},
  async verify({ ports, config }) {
    const path = await ports.docker.locate();
    if (!path) {
      return {
        ok: false,
        detail: "Docker Desktop is not installed. Install it, then check again.",
        help: { label: "Get Docker Desktop", url: config.dockerDownloadUrl },
      };
    }
    if (!(await ports.docker.isRunning())) {
      // Installed and running are different problems with different fixes,
      // and telling someone the wrong one costs them an afternoon.
      return {
        ok: false,
        detail: "Docker Desktop is installed but not running. Start it, then check again.",
      };
    }
    return { ok: true, detail: "Docker Desktop is running." };
  },
};

export const secretsStep: SetupStep = {
  id: "secrets",
  title: "Data folder and secrets",
  description:
    "Creates a folder for this installation and generates every password and key it needs.",
  async execute(context) {
    const { ports, config } = context;
    const envPath = `${config.dataDir}/.env`;
    context.bag[BAG.envPath] = envPath;

    await ports.fs.ensureDir(config.dataDir);

    const existing = await ports.fs.readFile(envPath);
    if (existing) {
      // Never regenerate: the database on disk is encrypted and signed with
      // the secrets that are already there. New ones would lock the user out
      // of their own data with no error that says so.
      context.log(`Keeping the existing configuration in ${envPath}.`);
      return;
    }

    const template = await ports.fs.readFile(`${config.deployDir}/.env.example`);
    if (!template) throw new Error("The bundled configuration template is missing.");

    const secrets = generateStackSecrets(ports.crypto, ports.clock);
    const contents = fillEnvTemplate(template, {
      POSTGRES_PASSWORD: secrets.postgresPassword,
      JWT_SECRET: secrets.jwtSecret,
      ANON_KEY: secrets.anonKey,
      SERVICE_ROLE_KEY: secrets.serviceRoleKey,
      APP_ENCRYPTION_KEY: secrets.appEncryptionKey,
      CRON_SECRET: secrets.cronSecret,
      // Image mode, pinned to this build. Upgrading the app is what rolls the
      // local stack forward. Joined with the platform's separator: Compose
      // splits this on `;` on Windows, `:` elsewhere.
      COMPOSE_FILE: ["docker-compose.yml", "docker-compose.images.yml"].join(
        config.composePathSeparator,
      ),
      CIELE_IMAGE_TAG: config.imageTag ?? "",
      PUBLIC_URL: config.appUrl,
      SUPABASE_PUBLIC_URL: config.supabaseUrl,
    });
    await ports.fs.writeFile(envPath, contents, { mode: 0o600 });
    context.log(`Generated six secrets into ${envPath}.`);
  },
  async verify({ ports, bag }) {
    const path = bag[BAG.envPath];
    const contents = path ? await ports.fs.readFile(path) : null;
    if (!contents) return { ok: false, detail: "The configuration file was not written." };
    const values = parseEnvFile(contents);
    const missing = [
      "POSTGRES_PASSWORD",
      "JWT_SECRET",
      "ANON_KEY",
      "SERVICE_ROLE_KEY",
      "APP_ENCRYPTION_KEY",
      "CRON_SECRET",
    ].filter((key) => !values[key]);
    if (missing.length > 0) {
      return { ok: false, detail: `Still unset: ${missing.join(", ")}.` };
    }
    return { ok: true, detail: "Configuration written and readable." };
  },
};

export const pullStep: SetupStep = {
  id: "pull",
  title: "Download Ciele",
  description: "Pulls the published container images. A few minutes on a first run.",
  async execute(context) {
    // A build the release workflow never stamped has no published images to
    // pin. Saying so here is the difference between an instruction and a
    // registry error against a tag that was never created.
    if (!context.config.imageTag) {
      throw new Error(
        "This build of Ciele Desktop is not a release, so it does not know which " +
          "images to download. Set CIELE_IMAGE_TAG to a published release (for " +
          "example v0.4.0) and try again.",
      );
    }
    await runCompose(
      context,
      ["pull"],
      "Could not download the images. Check your internet connection and try again.",
    );
  },
  // Nothing to probe: a `pull` that exits 0 has the images, and the next step
  // fails loudly if it somehow does not.
  verify: async () => ({ ok: true, detail: "Images downloaded." }),
};

export const startStep: SetupStep = {
  id: "start",
  title: "Start the stack",
  description: "Brings up the database, the app and the scheduled jobs.",
  async execute(context) {
    await runCompose(context, ["up", "-d"], "The stack did not start.");
  },
  async verify({ ports, config }) {
    const response = await ports.probe.get(`${config.supabaseUrl}${GATEWAY_HEALTH_PATH}`);
    if (!response) {
      return { ok: false, detail: "The database layer is not answering yet." };
    }
    if (response.status >= 400) {
      return { ok: false, detail: `The database layer answered ${response.status}.` };
    }
    return { ok: true, detail: "The database layer is up." };
  },
};

export const migrateStep: SetupStep = {
  id: "migrate",
  title: "Prepare the database",
  description: "Applies the schema and waits for Ciele to answer.",
  async execute(context) {
    // `up -d` already ran the one-shot migrate container; waiting on it is
    // what turns "started" into "finished successfully".
    await runCompose(
      context,
      ["wait", "migrate"],
      "The database migration did not finish. Open the logs for what it said.",
    );
  },
  async verify({ ports, config }) {
    const response = await ports.probe.get(config.appUrl);
    if (!response) return { ok: false, detail: "Ciele is not answering yet." };
    if (response.status >= 500) {
      return { ok: false, detail: `Ciele answered ${response.status}.` };
    }
    return { ok: true, detail: "Ciele is running." };
  },
};

export const seedStep: SetupStep = {
  id: "seed",
  title: "Demo content",
  description:
    "Optional. Loads an example organization with assistants so you can see a populated product before adding your own.",
  optional: true,
  async execute(context) {
    await runCompose(
      context,
      ["run", "--rm", "-e", "LOAD_DEMO_SEED=1", "migrate"],
      "The demo content could not be loaded. Skipping it leaves a working, empty Ciele.",
    );
    context.bag[BAG.seeded] = "1";
  },
  async verify({ ports, config }) {
    // The seed run exiting 0 only means the script ran; whether anything landed
    // is a question for the database. A fresh install has zero assistants, and
    // the demo content's whole point is that it has some.
    const result = await ports.docker.compose(
      composeArgs(config, [
        "exec",
        "-T",
        "postgres",
        "psql",
        "-U",
        "postgres",
        "-d",
        "postgres",
        "-tAc",
        "select count(*) from public.assistants",
      ]),
    );
    const count = Number(result.output.trim().split("\n").at(-1));
    if (result.code !== 0 || !Number.isFinite(count)) {
      return { ok: false, detail: "Could not check the demo content against the database." };
    }
    if (count === 0) return { ok: false, detail: "The demo content did not load." };
    return { ok: true, detail: "Demo content loaded." };
  },
};

export const modelStep: SetupStep = {
  id: "model",
  title: "Connect an AI model",
  description:
    "Optional. Point Ciele at a local model server or a hosted provider. Without one, assistants answer from the built-in keyword engine.",
  optional: true,
  fields: [
    {
      id: "baseUrl",
      label: "Model server address",
      hint: "Any OpenAI-compatible server. For Ollama on this machine, use http://host.docker.internal:11434/v1.",
      placeholder: "http://host.docker.internal:11434/v1",
    },
    { id: "chatModel", label: "Chat model", placeholder: "llama3.1:8b" },
    { id: "embeddingModel", label: "Embedding model", placeholder: "nomic-embed-text" },
    { id: "apiKey", label: "API key", hint: "Leave empty for a local server.", secret: true },
  ],
  async execute(context) {
    const baseUrl = (context.input.baseUrl ?? "").trim();
    if (!baseUrl) throw new Error("Enter a model server address, or skip this step.");

    const envPath = context.bag[BAG.envPath];
    if (!envPath) throw new Error("The configuration file is missing.");
    const current = await context.ports.fs.readFile(envPath);
    if (!current) throw new Error("The configuration file is missing.");

    // Only ever fills blanks, so a user who already edited the file by hand
    // keeps their edit.
    const updated = fillEnvTemplate(current, {
      OPENAI_COMPATIBLE_BASE_URL: baseUrl,
      OPENAI_COMPATIBLE_CHAT_MODEL: (context.input.chatModel ?? "").trim(),
      OPENAI_COMPATIBLE_EMBEDDING_MODEL: (context.input.embeddingModel ?? "").trim(),
      OPENAI_COMPATIBLE_API_KEY: (context.input.apiKey ?? "").trim(),
    });
    await context.ports.fs.writeFile(envPath, updated, { mode: 0o600 });
    // The app reads these at start, so it has to come back up to see them.
    // Never logged: the key is in that file and nowhere else.
    context.log("Restarting Ciele with the new model settings…");
    await runCompose(context, ["up", "-d", "app"], "Ciele did not restart.");
    context.bag[BAG.modelConfigured] = "1";
  },
  async verify({ ports, config }) {
    const response = await ports.probe.get(config.appUrl);
    if (!response) return { ok: false, detail: "Ciele did not come back up." };
    // A restarted app that answers 500 has not accepted the settings, and
    // calling that "saved" would put a green check on a broken configuration.
    if (response.status >= 500) {
      return { ok: false, detail: `Ciele answered ${response.status} after the restart.` };
    }
    return { ok: true, detail: "Model settings saved." };
  },
};

export const doneStep: SetupStep = {
  id: "done",
  title: "Ready",
  description: "Your local Ciele is running. The first account you create owns it.",
  execute: async () => {},
  verify: async () => ({ ok: true }),
};

export const SETUP_STEPS: readonly SetupStep[] = [
  dockerStep,
  secretsStep,
  pullStep,
  startStep,
  migrateStep,
  seedStep,
  modelStep,
  doneStep,
];
