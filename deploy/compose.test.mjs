// Contract test for the self-host stack (#440).
//
// Docker is not available everywhere this repo is developed, and `docker
// compose config` in CI proves the file parses, not that it still says what
// we promise. This asserts the promises: which profiles are on by default,
// that the heavy ones are not, that the app cannot serve before migrations
// have run, and that the self-host scheduler stays in step with vercel.json.
//
// Plain node + assert, matching the repo's script-test convention:
//   node deploy/compose.test.mjs

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { copyFileSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (rel) => readFileSync(path.join(here, rel), "utf8");

let passed = 0;
function check(label, fn) {
  fn();
  passed++;
  console.log(`  ok, ${label}`);
}

const compose = read("docker-compose.yml");
const imagesOverlay = read("docker-compose.images.yml");
const workersOverlay = read("docker-compose.workers.yml");
const envExample = read(".env.example");
const crontab = read("cron/crontab");
const vercel = JSON.parse(read("../apps/web/vercel.json"));

/**
 * Minimal reader for the one shape we assert: `service:` at two-space indent,
 * and its `profiles: [x]` line. A YAML parser would be a new dependency for
 * a repo-tooling test; `docker compose config` in CI is the real parser.
 */
function serviceProfiles(yaml) {
  const found = {};
  let current = null;
  let inServices = false;
  for (const line of yaml.split("\n")) {
    // Top-level key: enter `services:`, leave on the next one (`volumes:`).
    if (/^[a-z]/.test(line)) {
      inServices = line.startsWith("services:");
      current = null;
      continue;
    }
    if (!inServices) continue;
    const service = /^ {2}([a-z][a-z0-9-]*):\s*$/.exec(line);
    if (service) {
      current = service[1];
      found[current] = null;
      continue;
    }
    const profiles = /^ {4}profiles:\s*\[([^\]]*)\]/.exec(line);
    if (profiles && current) {
      found[current] = profiles[1].split(",").map((p) => p.trim());
    }
  }
  return found;
}

const profiles = serviceProfiles(compose);
const defaultProfiles = /^COMPOSE_PROFILES=(.+)$/m
  .exec(envExample)[1]
  .split(",")
  .map((p) => p.trim());

check("the default profiles are db, migrate, app and cron", () => {
  assert.deepEqual(defaultProfiles, ["db", "migrate", "app", "cron"]);
});

check("every service declares exactly one profile", () => {
  for (const [service, list] of Object.entries(profiles)) {
    assert.ok(list, `service "${service}" declares no profile`);
    assert.equal(
      list.length,
      1,
      `service "${service}" is in ${list.length} profiles; one keeps the on/off story simple`
    );
  }
});

check("studio is opt-in, nothing heavy starts by default", () => {
  const optIn = Object.entries(profiles)
    .filter(([, list]) => !defaultProfiles.includes(list[0]))
    .map(([service]) => service)
    .sort();
  assert.deepEqual(optIn, ["meta", "studio"]);
  for (const service of ["studio", "meta"]) {
    assert.deepEqual(profiles[service], ["studio"]);
  }
});

check("the base file names no worker, the overlay is the only way in", () => {
  // The bug this shape exists to prevent: compose interpolates every service
  // in a file *before* it filters by profile, so the `:?` guards below, while
  // they lived in docker-compose.yml, aborted a plain `docker compose up`
  // over a credential for a container that was never going to start. A
  // `workers` profile cannot be made safe. A separate file is never parsed.
  for (const worker of ["graph-worker", "crawl4ai"]) {
    assert.doesNotMatch(
      compose,
      new RegExp(`^ {2}${worker}:$`, "m"),
      `${worker} is back in docker-compose.yml; its :? guard breaks every default up`
    );
  }
  assert.deepEqual(
    Object.keys(serviceProfiles(workersOverlay)).sort(),
    ["crawl4ai", "graph-worker"],
    "the workers overlay must hold exactly the two workers"
  );
  // A profile inside the overlay would keep them off even with the file on,
  // which is the one thing adding the overlay is supposed to mean.
  assert.doesNotMatch(
    workersOverlay,
    /^ {4}profiles:/m,
    "the overlay's presence in COMPOSE_FILE is the switch; a profile would be a second one"
  );
  // The graph worker's volume came along with it: a named volume used by a
  // file that does not declare it is a compose error, not a fallback.
  assert.match(workersOverlay, /^volumes:\n {2}graph-data:$/m);
  assert.doesNotMatch(compose, /^ {2}graph-data:$/m);
});

check("a worker cannot start without its credential", () => {
  // Each worker token uses the `:?` form, so turning the overlay on without
  // one stops compose with a named error instead of starting a worker that
  // listens unauthenticated on the shared network. `:-` (empty default) would
  // do the opposite, silently. Living in an overlay is what makes the strict
  // form affordable: nothing interpolates this file until an operator asks.
  for (const variable of [
    "GRAPH_WORKER_API_TOKEN",
    "GRAPH_LLM_API_KEY",
    "CRAWL4AI_API_TOKEN",
    "CRAWL4AI_SECRET_KEY",
  ]) {
    const guarded = new RegExp(`\\$\\{${variable}:\\?[^}]+\\}`);
    assert.match(
      workersOverlay,
      guarded,
      `${variable} must use \${${variable}:?message} so the workers refuse to start without it`,
    );
  }
});

check("the image's deps stage copies every workspace manifest the app needs", () => {
  /* The `app` service builds apps/web/Dockerfile, whose deps stage installs from
     the lockfile with an explicit list of manifests. A workspace package added to
     apps/web's dependency closure and not to that list gets no node_modules link,
     and the build dies compiling the package's own source, packages ship as
     source, so the error reads "Can't resolve '@agent-hub/core'" from inside the
     new package rather than as a missing dependency of the app.

     That is exactly how it broke once: a new operations package landed with no
     Dockerfile change, and only the real Docker build caught it, minutes in and
     after the fast gates had already gone green. Deriving the closure from the
     manifests catches it in milliseconds instead. */
  const dockerfile = read("../apps/web/Dockerfile");
  const manifest = (dir) => JSON.parse(read(`../${dir}/package.json`));

  /** Workspace dirs reachable from apps/web through `workspace:` deps. */
  const closure = new Set();
  const byName = new Map();
  for (const entry of ["packages", "apps"]) {
    for (const dir of readdirSync(path.join(here, "..", entry), { withFileTypes: true })) {
      if (!dir.isDirectory()) continue;
      const relative = `${entry}/${dir.name}`;
      try {
        byName.set(manifest(relative).name, relative);
      } catch {
        // Not a workspace package (no manifest); nothing to link.
      }
    }
  }

  const walk = (dir) => {
    // Runtime deps only: devDependencies are not installed by the build stage
    // and a package's own tooling never reaches the image.
    for (const [name, range] of Object.entries(manifest(dir).dependencies ?? {})) {
      if (!String(range).startsWith("workspace:")) continue;
      const target = byName.get(name);
      assert.ok(target, `${dir} depends on workspace package "${name}", which has no directory`);
      if (closure.has(target)) continue;
      closure.add(target);
      walk(target);
    }
  };
  walk("apps/web");

  for (const dir of [...closure].sort()) {
    assert.ok(
      dockerfile.includes(`COPY ${dir}/package.json ${dir}/`),
      `apps/web/Dockerfile must COPY ${dir}/package.json, apps/web depends on it, so pnpm needs its manifest to link it`
    );
  }
});

// --- image mode (#686) ------------------------------------------------------
//
// The overlay is the whole switch: adding it to COMPOSE_FILE runs published
// images, leaving it out builds from source. What must hold is that the
// default is untouched and that the overlay changes nothing but the source of
// those three services.

/** The services the repo builds, the only ones image mode can replace. */
const BUILT_SERVICES = ["migrate", "app", "cron"];

check("the default is still a source build, the overlay is opt-in", () => {
  for (const service of BUILT_SERVICES) {
    assert.match(
      compose,
      new RegExp(`^ {2}${service}:$[\\s\\S]*?^ {4}build:$`, "m"),
      `${service} must still declare build: in the base file, or leaving the overlay out stops working`
    );
  }
  // An `image:` in the base file would make the switch ambiguous: compose
  // would pull rather than build with no overlay in play.
  const baseServiceSection = (name) =>
    new RegExp(`^ {2}${name}:$([\\s\\S]*?)(?=^ {2}[a-z]|^[a-z])`, "m").exec(compose)[1];
  for (const service of BUILT_SERVICES) {
    assert.doesNotMatch(
      baseServiceSection(service),
      /^ {4}image:/m,
      `${service} must not name an image in the base file; that is the overlay's job`
    );
  }
});

check("image mode pins every built service to the release tag", () => {
  const overlayServices = Object.keys(serviceProfiles(imagesOverlay));
  assert.deepEqual(
    overlayServices.sort(),
    [...BUILT_SERVICES].sort(),
    "the overlay must cover exactly the services the repo builds, no more (it would shadow a published image), no fewer (that one would still build from source)"
  );
  for (const service of BUILT_SERVICES) {
    assert.match(
      imagesOverlay,
      new RegExp(`^ {2}${service}:$[\\s\\S]*?/${service}:\\$\\{CIELE_IMAGE_TAG:\\?`, "m"),
      `${service} must resolve to <registry>/${service}:\${CIELE_IMAGE_TAG:?…}, the :? form refuses to start on an unset tag rather than pulling :latest`
    );
  }
});

check("image mode refuses to fall back to a silent source build", () => {
  // Compose's default pull policy builds when the pull fails, so a typo'd tag
  // would surface as an unexplained multi-minute build instead of an error.
  const pulls = [...imagesOverlay.matchAll(/^ {4}pull_policy: always$/gm)];
  assert.equal(
    pulls.length,
    BUILT_SERVICES.length,
    "every service in the overlay needs pull_policy: always"
  );
});

check("the overlay changes nothing but where those services come from", () => {
  // Ports, profiles, depends_on and environment all stay in the base file:
  // the migrate-before-app ordering and the profile wiring must be identical
  // in both modes, and duplicating them here is how they would drift.
  for (const key of ["profiles", "ports", "depends_on", "environment", "volumes"]) {
    assert.doesNotMatch(
      imagesOverlay,
      new RegExp(`^ {4}${key}:`, "m"),
      `the overlay sets ${key}: that belongs in the base file, where both modes read it`
    );
  }
});

check(".env.example documents both switches, and leaves them off", () => {
  assert.match(
    envExample,
    /^COMPOSE_FILE=$/m,
    "COMPOSE_FILE must ship empty: both overlays are opt-in"
  );
  assert.match(envExample, /^CIELE_IMAGE_TAG=$/m);
  assert.match(
    envExample,
    /docker-compose\.yml:docker-compose\.images\.yml/,
    ".env.example must show the exact COMPOSE_FILE value that turns image mode on"
  );
  assert.match(
    envExample,
    /docker-compose\.workers\.yml/,
    ".env.example must name the workers overlay; it is the only way to run them"
  );
  // Nothing may promise a `workers` profile any more: it does not exist, and
  // an operator who writes it into COMPOSE_PROFILES gets silence, not workers.
  assert.doesNotMatch(
    envExample,
    /^COMPOSE_PROFILES=.*workers/m,
    "the workers are an overlay now, not a profile"
  );
});

check("bootstrap --images turns the overlay on and stops forcing a build", () => {
  const bootstrap = read("bootstrap.sh");
  // COMPOSE_FILE goes into .env, not onto the command line, so a later bare
  // `docker compose up` stays in image mode. What it composes is asserted for
  // real further down, by running the script.
  assert.match(bootstrap, /replace_var COMPOSE_FILE "\$overlays"/);
  assert.match(bootstrap, /replace_var CIELE_IMAGE_TAG/);
  // `up --build` rebuilds from source even with an image pinned, which would
  // defeat the entire mode.
  assert.doesNotMatch(
    bootstrap,
    /up -d --build/,
    "bootstrap must decide --build from the mode, not hardcode it"
  );
});

check("the published app image is built with the sentinels its entrypoint rewrites", () => {
  // NEXT_PUBLIC_* is inlined at build time, measured: ~114 chunks under
  // .next/server, none under .next/static. A published image therefore cannot
  // carry a real anon key (it is a JWT signed with each install's own secret),
  // so it carries a sentinel and rewrites it at container start. The two
  // sides are separate files; if they drift, the image serves an unresolvable
  // `.invalid` host and every request fails with no clue why.
  const entrypoint = read("../apps/web/docker-entrypoint.sh");
  const publish = read("../.github/workflows/docker-publish.yml");
  const sentinels = [...entrypoint.matchAll(/^SENTINEL_[A-Z_]+="([^"]+)"$/gm)].map((m) => m[1]);
  assert.equal(sentinels.length, 2, "the entrypoint must declare exactly the two sentinels");
  for (const sentinel of sentinels) {
    assert.ok(
      publish.includes(sentinel),
      `the publish workflow must build with ${sentinel}; the entrypoint rewrites it and nothing else`
    );
  }
  assert.match(
    read("../apps/web/Dockerfile"),
    /ENTRYPOINT \["\/usr\/local\/bin\/docker-entrypoint\.sh"\]/,
    "the image must run the substitution entrypoint before the server"
  );
});

check("the app waits for migrations to finish before serving", () => {
  // Without this a fresh install answers requests against an empty schema.
  assert.match(
    compose,
    /migrate:\n\s+condition: service_completed_successfully/,
    "app must depend on migrate completing successfully"
  );
});

check("the migrate service waits for the auth and storage tables", () => {
  // Migrations reference auth.users and insert the three storage buckets;
  // both tables are installed by other containers at startup. Tables, not
  // schemas: the postgres image's baked init creates the `auth` schema at
  // first boot, so a schema probe passes before GoTrue has created
  // auth.users and the FK migrations fail.
  assert.match(compose, /WAIT_FOR_TABLES: "auth\.users,storage\.buckets"/);
});

check("the roles init never masks the image's own initdb directory", () => {
  // The supabase/postgres image bakes its init into /docker-entrypoint-initdb.d
  // (the postgres role, the auth.uid()/auth.role() helpers every RLS policy
  // calls, the supautils grants). Mounting a whole directory over it boots a
  // cluster with none of that: no postgres role, no auth helpers, migrations
  // dead on arrival. The roles pass must ride in as a single file beside the
  // image's own scripts.
  // And it must be a .sql file: the image's migrate.sh only executes *.sql
  // in init-scripts/, so a .sh is silently skipped and the service roles
  // never get this deployment's passwords.
  assert.doesNotMatch(
    compose,
    /db-init:\/docker-entrypoint-initdb\.d/,
    "db-init must not be mounted over the whole initdb directory"
  );
  assert.match(
    compose,
    /db-init\/99-roles\.sql:\/docker-entrypoint-initdb\.d\/init-scripts\/99-ciele-roles\.sql/
  );
});

check("GoTrue never receives an empty SMTP port", () => {
  // GoTrue parses GOTRUE_SMTP_PORT into an int before checking whether SMTP
  // is configured at all; an empty string is a fatal parse error that
  // crash-loops the container on every install that has no SMTP, which is
  // the default install.
  assert.doesNotMatch(compose, /GOTRUE_SMTP_PORT: \$\{SMTP_PORT:-\}/);
  assert.match(compose, /GOTRUE_SMTP_PORT: \$\{SMTP_PORT:-25\}/);
});

/**
 * Jobs whose schedule is allowed to differ between the two deployments, with
 * the reason. The *set of jobs* is never allowed to differ: that is the half of
 * this contract which stops a self-host silently skipping maintenance.
 *
 * `run-routines` and the durable-ledger `finalize-crawls` worker run more often
 * on a self-host than on Vercel because Vercel's Hobby plan rejects any
 * schedule that runs more than once a day, and rejects it by failing the whole
 * deployment. Listed here by name so another exception cannot spread quietly.
 */
const SCHEDULE_EXCEPTIONS = new Set([
  "/api/cron/finalize-crawls",
  "/api/cron/run-routines",
]);

function cronEntries(text) {
  return text
    .split("\n")
    .filter((line) => line.trim() && !line.startsWith("#"))
    .map((line) => {
      const [min, hour, dom, mon, dow, ...rest] = line.trim().split(/\s+/);
      return {
        path: rest[rest.length - 1],
        schedule: `${min} ${hour} ${dom} ${mon} ${dow}`,
      };
    });
}

check("the scheduler runs exactly the jobs vercel.json schedules", () => {
  const hosted = vercel.crons.map((c) => ({ path: c.path, schedule: c.schedule }));
  const selfHosted = cronEntries(crontab);

  assert.deepEqual(
    selfHosted.map((e) => e.path).sort(),
    hosted.map((e) => e.path).sort(),
    "deploy/cron/crontab and vercel.json disagree about which jobs exist, a self-host would silently skip maintenance"
  );

  const hostedByPath = new Map(hosted.map((e) => [e.path, e.schedule]));
  for (const entry of selfHosted) {
    if (SCHEDULE_EXCEPTIONS.has(entry.path)) continue;
    assert.equal(
      entry.schedule,
      hostedByPath.get(entry.path),
      `${entry.path} runs on a different schedule in deploy/cron/crontab than in vercel.json, so a self-host would skip or double-run it`
    );
  }
});

check("every documented schedule exception is still a real job", () => {
  // An exception for a job nobody schedules any more is a licence waiting to be
  // reused for something that does not deserve it.
  const paths = new Set(vercel.crons.map((c) => c.path));
  for (const path of SCHEDULE_EXCEPTIONS) {
    assert.ok(paths.has(path), `${path} is exempted but no longer scheduled`);
  }
});

check("bootstrap fills in every generated secret the compose files require", () => {
  const bootstrap = read("bootstrap.sh");
  const generated = [...bootstrap.matchAll(/set_var ([A-Z][A-Z0-9_]*)/g)].map((m) => m[1]);
  // Anything a compose file refuses to start without must be generated, or
  // the operator meets a `:?` error with no way to satisfy it. The one
  // exception is an account credential nothing can mint locally: the graph
  // worker's LLM key. Everything else, including the workers' own shared
  // secrets, is a random string this stack invents for itself.
  const cannotBeMinted = ["GRAPH_LLM_API_KEY", "CIELE_IMAGE_TAG"];
  const required = [compose, workersOverlay, imagesOverlay].flatMap((file) =>
    [...file.matchAll(/\$\{([A-Z][A-Z0-9_]*):\?/g)].map((m) => m[1])
  );
  const missing = [...new Set(required)]
    .filter((key) => !cannotBeMinted.includes(key))
    .filter((key) => !generated.includes(key));
  assert.deepEqual(
    missing,
    [],
    `bootstrap.sh does not generate: ${missing.join(", ")}, so that install cannot start`
  );
});

check(".env.example documents every variable bootstrap writes", () => {
  const bootstrap = read("bootstrap.sh");
  for (const [, key] of bootstrap.matchAll(/set_var ([A-Z][A-Z0-9_]*)/g)) {
    assert.match(
      envExample,
      new RegExp(`^${key}=`, "m"),
      `${key} is generated but not documented in .env.example`
    );
  }
});

// --- bootstrap actually produces a usable stack config ----------------------
//
// The riskiest code here is 20 lines of bash minting HS256 JWTs with openssl:
// if ANON_KEY or SERVICE_ROLE_KEY is signed wrong, every request the app makes
// is rejected and the install is dead on arrival with a confusing 401. So run
// the real script into a temp directory and verify the tokens with node.

const tmp = mkdtempSync(path.join(tmpdir(), "ciele-bootstrap-"));
try {
  copyFileSync(path.join(here, "bootstrap.sh"), path.join(tmp, "bootstrap.sh"));
  copyFileSync(path.join(here, ".env.example"), path.join(tmp, ".env.example"));
  execFileSync("bash", ["bootstrap.sh", "--env-only"], {
    cwd: tmp,
    stdio: "pipe",
  });
  const env = parseEnv(readFileSync(path.join(tmp, ".env"), "utf8"));

  check("bootstrap --env-only writes a complete .env", () => {
    for (const key of [
      "POSTGRES_PASSWORD",
      "JWT_SECRET",
      "ANON_KEY",
      "SERVICE_ROLE_KEY",
      "APP_ENCRYPTION_KEY",
      "CRON_SECRET",
    ]) {
      assert.ok(env[key], `${key} is empty after bootstrap`);
    }
    // Every secret must be distinct: reusing one would tie unrelated
    // compromises together.
    const secrets = [
      env.POSTGRES_PASSWORD,
      env.JWT_SECRET,
      env.APP_ENCRYPTION_KEY,
      env.CRON_SECRET,
    ];
    assert.equal(new Set(secrets).size, secrets.length);
  });

  check("the generated API keys are valid JWTs signed with JWT_SECRET", () => {
    for (const [key, role] of [
      ["ANON_KEY", "anon"],
      ["SERVICE_ROLE_KEY", "service_role"],
    ]) {
      const [header, payload, signature] = env[key].split(".");
      const expected = createHmac("sha256", env.JWT_SECRET)
        .update(`${header}.${payload}`)
        .digest("base64url");
      assert.equal(signature, expected, `${key} signature does not verify`);
      assert.equal(JSON.parse(atob(header)).alg, "HS256");
      const claims = JSON.parse(Buffer.from(payload, "base64url").toString());
      assert.equal(claims.role, role);
      assert.ok(
        claims.exp - claims.iat > 31536000,
        `${key} expires within a year; rotating it means rotating JWT_SECRET too`
      );
    }
  });

  check("APP_ENCRYPTION_KEY is a 32-byte key (AES-256)", () => {
    assert.equal(Buffer.from(env.APP_ENCRYPTION_KEY, "base64").length, 32);
  });

  check("POSTGRES_PASSWORD is safe inside a connection string", () => {
    // It is interpolated into the userinfo section of the database URL, so a
    // stray @, :, / or whitespace would silently truncate the URL and point
    // the app at the wrong host.
    //
    // (Spelled out rather than shown as a literal URL: a credential-shaped
    // example in a mirrored file trips the release gate's secret scan.)
    assert.doesNotMatch(env.POSTGRES_PASSWORD, /[@:/#?\s]/);
  });

  check("re-running bootstrap never overwrites existing secrets", () => {
    const before = readFileSync(path.join(tmp, ".env"), "utf8");
    execFileSync("bash", ["bootstrap.sh", "--env-only"], {
      cwd: tmp,
      stdio: "pipe",
    });
    assert.equal(readFileSync(path.join(tmp, ".env"), "utf8"), before);
  });
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

// The two switches compose: `--images` used to write COMPOSE_FILE wholesale,
// which silently dropped a workers overlay an operator had already turned on.
// Run the real script rather than reading its source, the value is built by
// shell string handling that a regex would not catch getting this wrong.
const tmpOverlays = mkdtempSync(path.join(tmpdir(), "ciele-overlays-"));
try {
  copyFileSync(path.join(here, "bootstrap.sh"), path.join(tmpOverlays, "bootstrap.sh"));
  copyFileSync(path.join(here, ".env.example"), path.join(tmpOverlays, ".env.example"));
  const run = (...args) =>
    execFileSync("bash", ["bootstrap.sh", "--env-only", ...args], {
      cwd: tmpOverlays,
      stdio: "pipe",
    });
  const envNow = () => parseEnv(readFileSync(path.join(tmpOverlays, ".env"), "utf8"));

  check("a default install runs the base file alone", () => {
    run();
    assert.equal(envNow().COMPOSE_FILE, "", "no flags must leave every overlay off");
  });

  check("--workers turns the overlay on and mints the three shared secrets", () => {
    run("--workers");
    const env = envNow();
    assert.equal(env.COMPOSE_FILE, "docker-compose.yml:docker-compose.workers.yml");
    const minted = [
      env.GRAPH_WORKER_API_TOKEN,
      env.CRAWL4AI_API_TOKEN,
      env.CRAWL4AI_SECRET_KEY,
    ];
    for (const secret of minted) assert.match(secret, /^[0-9a-f]{64}$/);
    assert.equal(new Set(minted).size, 3, "each worker credential must be its own secret");
    // The fourth is an account key; bootstrap says so instead of inventing one.
    assert.equal(env.GRAPH_LLM_API_KEY, "");
  });

  check("adding --images later keeps the workers overlay on", () => {
    const before = envNow();
    run("--images", "v9.9.9");
    const env = envNow();
    assert.equal(
      env.COMPOSE_FILE,
      "docker-compose.yml:docker-compose.workers.yml:docker-compose.images.yml"
    );
    assert.equal(env.CIELE_IMAGE_TAG, "v9.9.9");
    assert.equal(
      env.CRAWL4AI_API_TOKEN,
      before.CRAWL4AI_API_TOKEN,
      "a second run must never re-mint a secret the workers are already using"
    );
  });

  check("asking twice adds nothing twice", () => {
    run("--workers", "--images", "v9.9.9");
    assert.equal(
      envNow().COMPOSE_FILE,
      "docker-compose.yml:docker-compose.workers.yml:docker-compose.images.yml"
    );
  });
} finally {
  rmSync(tmpOverlays, { recursive: true, force: true });
}

console.log(`\n${passed} checks passed.`);
