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

check("workers and studio are opt-in, nothing heavy starts by default", () => {
  const optIn = Object.entries(profiles)
    .filter(([, list]) => !defaultProfiles.includes(list[0]))
    .map(([service]) => service)
    .sort();
  assert.deepEqual(optIn, ["crawl4ai", "graph-worker", "meta", "studio"]);
  for (const service of ["graph-worker", "crawl4ai"]) {
    assert.deepEqual(profiles[service], ["workers"]);
  }
  for (const service of ["studio", "meta"]) {
    assert.deepEqual(profiles[service], ["studio"]);
  }
});

check("a worker cannot start without its credential", () => {
  // Each worker token uses the `:?` form, so enabling the profile without one
  // stops compose with a named error instead of starting a worker that listens
  // unauthenticated on the shared network. `:-` (empty default) would do the
  // opposite, silently.
  //
  // The cost of the `:?` form is that `docker compose config`, which
  // interpolates every service regardless of profile, needs placeholder
  // values; the CI job supplies them and separately asserts this guard fires.
  for (const variable of [
    "GRAPH_WORKER_API_TOKEN",
    "GRAPH_LLM_API_KEY",
    "CRAWL4AI_API_TOKEN",
    "CRAWL4AI_SECRET_KEY",
  ]) {
    const guarded = new RegExp(`\\$\\{${variable}:\\?[^}]+\\}`);
    assert.match(
      compose,
      guarded,
      `${variable} must use \${${variable}:?message} so the workers profile refuses to start without it`,
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

check(".env.example documents the switch, and leaves it off", () => {
  assert.match(envExample, /^COMPOSE_FILE=$/m, "COMPOSE_FILE must ship empty, image mode is opt-in");
  assert.match(envExample, /^CIELE_IMAGE_TAG=$/m);
  assert.match(
    envExample,
    /docker-compose\.yml:docker-compose\.images\.yml/,
    ".env.example must show the exact COMPOSE_FILE value that turns image mode on"
  );
});

check("bootstrap --images turns the overlay on and stops forcing a build", () => {
  const bootstrap = read("bootstrap.sh");
  assert.match(
    bootstrap,
    /replace_var COMPOSE_FILE "docker-compose\.yml:docker-compose\.images\.yml"/,
    "--images must write COMPOSE_FILE so a later bare `docker compose up` stays in image mode"
  );
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

check("the migrate service waits for the auth and storage schemas", () => {
  // Migrations reference auth.users and insert the three storage buckets;
  // both schemas are installed by other containers at startup.
  assert.match(compose, /WAIT_FOR_SCHEMAS: "auth,storage"/);
});

check("the scheduler runs exactly the jobs vercel.json schedules", () => {
  const scheduled = vercel.crons
    .map((c) => `${c.schedule} ${c.path}`)
    .sort();
  const selfHosted = crontab
    .split("\n")
    .filter((line) => line.trim() && !line.startsWith("#"))
    .map((line) => {
      const [min, hour, dom, mon, dow, ...rest] = line.trim().split(/\s+/);
      return `${min} ${hour} ${dom} ${mon} ${dow} ${rest[rest.length - 1]}`;
    })
    .sort();
  assert.deepEqual(
    selfHosted,
    scheduled,
    "deploy/cron/crontab and vercel.json disagree, a self-host would silently skip or double-run maintenance"
  );
});

check("bootstrap fills in every generated secret the compose file requires", () => {
  const bootstrap = read("bootstrap.sh");
  // Anything the compose file refuses to start without must be generated.
  const required = [...compose.matchAll(/\$\{([A-Z_]+):\?/g)].map((m) => m[1]);
  const generated = [...bootstrap.matchAll(/set_var ([A-Z_]+)/g)].map((m) => m[1]);
  const workersOnly = [
    "GRAPH_WORKER_API_TOKEN",
    "GRAPH_LLM_API_KEY",
    "CRAWL4AI_API_TOKEN",
    "CRAWL4AI_SECRET_KEY",
  ];
  const missing = [...new Set(required)]
    .filter((key) => !workersOnly.includes(key))
    .filter((key) => !generated.includes(key));
  assert.deepEqual(
    missing,
    [],
    `bootstrap.sh does not generate: ${missing.join(", ")}, a default install would fail to start`
  );
});

check(".env.example documents every variable bootstrap writes", () => {
  const bootstrap = read("bootstrap.sh");
  for (const [, key] of bootstrap.matchAll(/set_var ([A-Z_]+)/g)) {
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
  const env = Object.fromEntries(
    readFileSync(path.join(tmp, ".env"), "utf8")
      .split("\n")
      .filter((line) => /^[A-Z]/.test(line))
      .map((line) => {
        const eq = line.indexOf("=");
        return [line.slice(0, eq), line.slice(eq + 1)];
      })
  );

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

console.log(`\n${passed} checks passed.`);
