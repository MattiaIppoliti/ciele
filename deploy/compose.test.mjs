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
import { copyFileSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
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
const standaloneWorkers = {
  "services/crawl4ai-worker/docker-compose.yml": read("../services/crawl4ai-worker/docker-compose.yml"),
  "services/graph-worker/docker-compose.yml": read("../services/graph-worker/docker-compose.yml"),
};
const tlsOverlay = read("docker-compose.tls.yml");
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

// --- network exposure (#801, CYB-06 / CYB-16) -------------------------------
//
// A published port with no bind address is every interface, and both worker
// files said "localhost" in a comment above a line that meant the internet.
// This is the resolved-config policy the audit asked for, read off the files
// so it holds without a Docker daemon.

/** Every `- "…:…"` entry under a `ports:` key, as written. */
function publishedPorts(yaml) {
  const found = [];
  let inPorts = false;
  for (const line of yaml.split("\n")) {
    if (/^\s*ports:\s*$/.test(line)) {
      inPorts = true;
      continue;
    }
    if (!inPorts) continue;
    const entry = /^\s*-\s*"([^"]+)"\s*$/.exec(line);
    if (entry) {
      found.push(entry[1]);
      continue;
    }
    // A non-comment, non-entry line ends the block.
    if (line.trim() && !line.trim().startsWith("#")) inPorts = false;
  }
  return found;
}

/** Loopback literal, or the BIND_ADDRESS variable whose default is loopback. */
function bindsToLoopback(entry) {
  if (entry.startsWith("127.0.0.1:")) return true;
  return entry.startsWith("${BIND_ADDRESS:-127.0.0.1}:");
}

check("nothing in the self-host stack publishes on every interface", () => {
  const entries = publishedPorts(compose);
  assert.ok(entries.length > 0, "the base file must still publish something");
  for (const entry of entries) {
    assert.ok(
      bindsToLoopback(entry),
      `${entry} binds every interface; give it a bind address (BIND_ADDRESS opts out)`
    );
  }
  assert.match(
    envExample,
    /^BIND_ADDRESS=127\.0\.0\.1$/m,
    ".env.example must document the loopback default operators opt out of"
  );
});

check("the database console is loopback-only whatever BIND_ADDRESS says", () => {
  const studio = publishedPorts(compose).filter((entry) => entry.includes("STUDIO_PORT"));
  assert.equal(studio.length, 1);
  assert.ok(
    studio[0].startsWith("127.0.0.1:"),
    "studio must not follow BIND_ADDRESS onto a public interface"
  );
});

/**
 * `networks: [a, b]` per service, same minimal-reader shape as
 * `serviceProfiles`. Reachability in compose IS network membership, so this
 * map is the stack's east-west policy.
 */
function serviceNetworks(yaml) {
  const found = {};
  let current = null;
  let inServices = false;
  for (const line of yaml.split("\n")) {
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
    const networks = /^ {4}networks:\s*\[([^\]]*)\]/.exec(line);
    if (networks && current) {
      found[current] = networks[1].split(",").map((n) => n.trim()).sort();
    }
  }
  return found;
}

check("every service sits in its declared zones, default-deny between them (#801, CYB-16)", () => {
  // The whole map, not a sample: adding a service without placing it lands
  // it on no network at all (compose only builds the default network when NO
  // service declares one), which this catches as `null`.
  assert.deepEqual(serviceNetworks(compose), {
    postgres: ["data"],
    auth: ["backend", "data"],
    rest: ["backend", "data"],
    storage: ["backend", "data"],
    gateway: ["backend"],
    migrate: ["data"],
    app: ["backend", "workers"],
    cron: ["backend"],
    studio: ["backend"],
    meta: ["backend", "data"],
  });
});

check("the workers zone holds only the app and the workers (#801, CYB-16)", () => {
  // A worker renders untrusted web pages; it must reach neither Postgres nor
  // the gateway. The overlay places both workers on `workers` alone, and the
  // only base service sharing that zone is the app that calls them.
  assert.deepEqual(serviceNetworks(workersOverlay), {
    "graph-worker": ["workers"],
    crawl4ai: ["workers"],
  });
  const base = serviceNetworks(compose);
  const sharing = Object.entries(base)
    .filter(([, zones]) => zones.includes("workers"))
    .map(([name]) => name);
  assert.deepEqual(sharing, ["app"]);
});

check("the app plane can never open a socket to Postgres", () => {
  const zones = serviceNetworks(compose);
  for (const service of ["app", "cron", "studio", "gateway"]) {
    assert.ok(
      !zones[service].includes("data"),
      `${service} must reach the database through the gateway's API surface, never directly`
    );
  }
  // And the database is nowhere else: `data` is its only zone.
  assert.deepEqual(zones.postgres, ["data"]);
});

check("the tls overlay is the one deliberate public listener (#801, CYB-16)", () => {
  // 80/443 on every interface is the terminator's job; anything else joining
  // it here would be a second public door nobody decided on.
  assert.deepEqual(publishedPorts(tlsOverlay), ["80:80", "443:443", "443:443/udp"]);
  // It reaches only the HTTP plane: on `backend`, never `data` or `workers`.
  assert.deepEqual(serviceNetworks(tlsOverlay), { tls: ["backend"] });
  // Refuses to start without the names it should answer for.
  assert.match(tlsOverlay, /CIELE_DOMAIN:\s*\$\{CIELE_DOMAIN:\?/);
  assert.match(tlsOverlay, /CIELE_SUPABASE_DOMAIN:\s*\$\{CIELE_SUPABASE_DOMAIN:\?/);
  // And the base stack stays TLS-free: the overlay is the only way in, same
  // rule as the workers.
  assert.ok(!compose.includes("caddy"), "no caddy in the base file");
  assert.match(envExample, /^CIELE_DOMAIN=$/m);
  assert.match(envExample, /^CIELE_SUPABASE_DOMAIN=$/m);
});

check("the workers overlay publishes no host port at all", () => {
  assert.deepEqual(
    publishedPorts(workersOverlay),
    [],
    "the integrated workers are reachable on the compose network only"
  );
});

check("the standalone worker files bind their dev ports to loopback", () => {
  for (const [name, yaml] of Object.entries(standaloneWorkers)) {
    const entries = publishedPorts(yaml);
    assert.ok(entries.length > 0, `${name} must still publish its dev port`);
    for (const entry of entries) {
      assert.ok(
        entry.startsWith("127.0.0.1:"),
        `${name} publishes ${entry} on every interface`
      );
    }
    assert.match(
      yaml,
      /security_opt:\n\s*- no-new-privileges:true/,
      `${name} must set no-new-privileges`
    );
  }
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

check("PUBLIC_URL has one default, and the app service receives it (#801, CYB-16)", () => {
  // GoTrue's site URL and the app's origin check read the same variable. When
  // the auth service interpolated `${PUBLIC_URL}` with no default while the
  // app defaulted to localhost, an .env missing the line gave GoTrue an empty
  // site URL and the app a passing one. Every reference carries the default
  // `.env.example` ships, so the two can only disagree by editing `.env`.
  const references = [...compose.matchAll(/\$\{PUBLIC_URL[^}]*\}/g)].map((m) => m[0]);
  assert.ok(references.length >= 4, "auth (three lines) and app must both read PUBLIC_URL");
  const shipped = /^PUBLIC_URL=(.+)$/m.exec(envExample)[1];
  for (const reference of references) {
    assert.equal(
      reference,
      `\${PUBLIC_URL:-${shipped}}`,
      `${reference} must default to the value .env.example ships, like every other reference`
    );
  }
  const appSection = /^ {2}app:$([\s\S]*?)(?=^ {2}[a-z]|^[a-z])/m.exec(compose)[1];
  assert.match(
    appSection,
    /^ {6}PUBLIC_URL: \$\{PUBLIC_URL:-/m,
    "the app service must receive PUBLIC_URL; the startup origin check reads it"
  );
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

check("PostgREST accepts the aggregate the Improvements board reads with", () => {
  // `packages/db/src/supabase.ts` selects `improvement_messages(id.count())`.
  // PostgREST ships with aggregates off and answers that select with a 400,
  // and the pglite contract shim accepts the syntax regardless, so the only
  // thing standing between a green test run and a broken board on a fresh
  // self-host is this line.
  assert.match(
    compose,
    /^ {6}PGRST_DB_AGGREGATES_ENABLED: "true"$/m,
    "the rest service must set PGRST_DB_AGGREGATES_ENABLED, or every Improvements list 400s"
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
  // Human review expiry (#841) is measured in hours, so the self-host ticks
  // hourly; the Hobby plan gets daily.
  "/api/cron/run-reviews",
  "/api/cron/run-webhooks",
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
  // …and the coordinates of a database the operator already owns, which
  // `--database-url` copies in rather than invents.
  const cannotBeMinted = [
    "GRAPH_LLM_API_KEY",
    "CIELE_IMAGE_TAG",
    "EXTERNAL_DB_HOST",
    "EXTERNAL_DB_NAME",
    "EXTERNAL_DB_ADMIN_USER",
    "EXTERNAL_DB_ADMIN_PASSWORD",
  ];
  const required = [compose, workersOverlay, imagesOverlay, read("docker-compose.external-db.yml")].flatMap((file) =>
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

// --- external database (#811) ------------------------------------------------
//
// The overlay swaps the `postgres` container for a managed Postgres. What must
// hold: postgres really is off, a provisioning step runs before any service
// connects, every database URL points at the external host, the applier still
// waits for GoTrue and storage-api, and the base file is untouched.

const externalDbOverlay = read("docker-compose.external-db.yml");
const externalDbSection = (name) =>
  new RegExp(`^ {2}${name}:$([\\s\\S]*?)(?=^ {2}[a-z]|^[a-z]|$(?![\\s\\S]))`, "m").exec(externalDbOverlay)?.[1];

check("the external-db overlay changes no network membership", () => {
  // Reachability is network membership (the base file's zone map is asserted
  // above). The overlay re-points URLs and adds one service on `data`; it
  // must not move anything else, or the default-deny policy would silently
  // differ between the two modes.
  assert.deepEqual(serviceNetworks(externalDbOverlay), {
    postgres: null,
    provision: ["data"],
    auth: null,
    rest: null,
    storage: null,
    migrate: null,
    studio: null,
    meta: null,
  });
});

check("the external-db overlay parks postgres in a profile nobody activates", () => {
  // An overlay cannot delete a service; `!override` replaces the profile list
  // wholesale (a plain `profiles:` would *merge* with `db` and postgres would
  // still start).
  assert.match(
    externalDbSection("postgres"),
    /^ {4}profiles: !override \[external-db-disabled\]$/m,
    "postgres must be moved out of the db profile with !override, not merged"
  );
  assert.doesNotMatch(envExample, /^COMPOSE_PROFILES=.*external-db-disabled/m);
});

check("provisioning runs before anything connects to the external database", () => {
  const provision = externalDbSection("provision");
  assert.ok(provision, "the overlay must define a provision service");
  assert.match(provision, /^ {4}profiles: \[db\]$/m, "provision belongs to the db profile like the services it gates");
  assert.match(provision, /dockerfile: deploy\/migrate\.Dockerfile/, "provision reuses the migrate image");
  assert.match(provision, /entrypoint: \["\/usr\/local\/bin\/provision-entrypoint\.sh"\]/);
  assert.match(provision, /^ {4}networks: \[data\]$/m, "provision speaks only to the database");
  for (const service of ["auth", "rest", "storage", "migrate", "meta"]) {
    assert.match(
      externalDbSection(service),
      /^ {4}depends_on: !override\n {6}provision:\n {8}condition: service_completed_successfully/m,
      `${service} must wait for provision to complete (and drop its dependency on postgres)`
    );
  }
  // The applier still waits for the two services that own auth.users and
  // storage.buckets; the base file's WAIT_FOR_TABLES does the rest.
  assert.match(externalDbSection("migrate"), /^ {6}auth:\n {8}condition: service_started/m);
  assert.match(externalDbSection("migrate"), /^ {6}storage:\n {8}condition: service_started/m);
  assert.match(externalDbSection("studio"), /^ {4}depends_on: !reset \[\]$/m);
});

check("every database URL in the overlay points at the external host, over TLS", () => {
  const urls = [...externalDbOverlay.matchAll(/^ {6}([A-Z_]+): (postgresql:\/\/[^\n]+)$/gm)];
  const names = urls.map((m) => m[1]).sort();
  assert.deepEqual(names, [
    "DATABASE_URL",
    "GOTRUE_DB_DATABASE_URL",
    "PGRST_DB_URI",
    "PROVISION_DB_URL",
    "SUPABASE_DB_URL",
  ]);
  for (const [, name, url] of urls) {
    assert.match(url, /@\$\{EXTERNAL_DB_HOST[^}]*\}:\$\{EXTERNAL_DB_PORT:-5432\}\/\$\{EXTERNAL_DB_NAME[^}]*\}/, `${name} must use the EXTERNAL_DB_* host, port and name`);
    assert.match(
      url,
      /\?sslmode=\$\{EXTERNAL_DB_SSLMODE:-require\}\$\{EXTERNAL_DB_CA_FILE:\+&sslrootcert=\/certs\/db-ca\.pem\}$/,
      `${name} must carry sslmode (default require) and, only with a CA file, sslrootcert`
    );
    assert.doesNotMatch(url, /@postgres:5432/, `${name} still points at the postgres container`);
  }
  // Provision and the applier connect as the admin; the services as their own
  // logins with the one shared service password.
  assert.match(externalDbSection("provision"), /PROVISION_DB_URL: postgresql:\/\/\$\{EXTERNAL_DB_ADMIN_USER:\?/);
  assert.match(externalDbSection("migrate"), /SUPABASE_DB_URL: postgresql:\/\/\$\{EXTERNAL_DB_ADMIN_USER\}/);
  assert.match(externalDbSection("auth"), /postgresql:\/\/supabase_auth_admin:\$\{EXTERNAL_DB_SERVICE_PASSWORD\}@/);
  assert.match(externalDbSection("rest"), /postgresql:\/\/authenticator:\$\{EXTERNAL_DB_SERVICE_PASSWORD\}@/);
  assert.match(externalDbSection("storage"), /postgresql:\/\/supabase_storage_admin:\$\{EXTERNAL_DB_SERVICE_PASSWORD\}@/);
});

check("storage-api's role installer is off and its owner role is named", () => {
  // The installer runs `create role service_role ... bypassrls` with no IF NOT
  // EXISTS: superuser-only on stock Postgres, and a failure on the second boot
  // even where the first passed. Provision owns the roles.
  const storage = externalDbSection("storage");
  assert.match(storage, /^ {6}DB_INSTALL_ROLES: "false"$/m);
  assert.match(storage, /^ {6}DB_SUPER_USER: supabase_storage_admin$/m);
});

check("the external-db overlay caps every pool for small managed tiers", () => {
  assert.match(externalDbSection("auth"), /^ {6}GOTRUE_DB_MAX_POOL_SIZE: "\d+"$/m, "GoTrue's default pool is unbounded");
  assert.match(externalDbSection("rest"), /^ {6}PGRST_DB_POOL: "\d+"$/m);
  assert.match(externalDbSection("storage"), /^ {6}DATABASE_MAX_CONNECTIONS: "\d+"$/m);
});

check("the external-db overlay refuses to start without its inputs", () => {
  // Same rule as the workers: the `:?` form names the missing variable instead
  // of connecting to an empty hostname. Affordable only because this is an
  // overlay nothing interpolates until an operator lists it.
  for (const variable of [
    "EXTERNAL_DB_HOST",
    "EXTERNAL_DB_NAME",
    "EXTERNAL_DB_ADMIN_USER",
    "EXTERNAL_DB_ADMIN_PASSWORD",
    "EXTERNAL_DB_SERVICE_PASSWORD",
  ]) {
    assert.match(
      externalDbOverlay,
      new RegExp(`\\$\\{${variable}:\\?[^}]+\\}`),
      `${variable} must use \${${variable}:?message} somewhere in the overlay`
    );
    assert.match(envExample, new RegExp(`^${variable}=`, "m"), `${variable} must be documented in .env.example`);
  }
  assert.match(envExample, /docker-compose\.external-db\.yml/, ".env.example must name the external-db overlay");
});

check("the base file knows nothing about the external database", () => {
  assert.doesNotMatch(compose, /EXTERNAL_DB_/, "the base file must not read EXTERNAL_DB_*; the overlay is the switch");
  assert.doesNotMatch(compose, /^ {2}provision:$/m, "provision lives in the overlay only");
  // The migrate image carries both entrypoints, so the overlay needs no second image.
  const dockerfile = read("migrate.Dockerfile");
  assert.match(dockerfile, /COPY deploy\/external-db\/provision\.sql/);
  assert.match(dockerfile, /COPY deploy\/provision-entrypoint\.sh \/usr\/local\/bin\/provision-entrypoint\.sh/);
});

// `--database-url` is the whole user-facing contract (#812): one admin URL in,
// the EXTERNAL_DB_* lines and the overlay out, a minted service password, and
// the image-mode wiring for the provision service. Run the real script.
const tmpExternal = mkdtempSync(path.join(tmpdir(), "ciele-external-db-"));
try {
  copyFileSync(path.join(here, "bootstrap.sh"), path.join(tmpExternal, "bootstrap.sh"));
  copyFileSync(path.join(here, ".env.example"), path.join(tmpExternal, ".env.example"));
  const run = (...args) =>
    execFileSync("bash", ["bootstrap.sh", "--env-only", ...args], {
      cwd: tmpExternal,
      stdio: "pipe",
    });
  const envNow = () => parseEnv(readFileSync(path.join(tmpExternal, ".env"), "utf8"));
  const refused = (...args) => {
    try {
      run(...args);
    } catch (err) {
      return String(err.stderr);
    }
    assert.fail(`bootstrap accepted ${args.join(" ")}`);
  };

  check("--database-url splits the admin URL into the overlay's inputs and mints the service password", () => {
    run("--database-url", "postgresql://ciele_admin:s3cret@db.example.test:5433/cieledb?sslmode=require");
    const env = envNow();
    assert.equal(env.COMPOSE_FILE, "docker-compose.yml:docker-compose.external-db.yml");
    assert.equal(env.EXTERNAL_DB_HOST, "db.example.test");
    assert.equal(env.EXTERNAL_DB_PORT, "5433");
    assert.equal(env.EXTERNAL_DB_NAME, "cieledb");
    assert.equal(env.EXTERNAL_DB_ADMIN_USER, "ciele_admin");
    assert.equal(env.EXTERNAL_DB_ADMIN_PASSWORD, "s3cret");
    assert.match(env.EXTERNAL_DB_SERVICE_PASSWORD, /^[0-9a-f]{64}$/);
    assert.notEqual(env.EXTERNAL_DB_SERVICE_PASSWORD, env.POSTGRES_PASSWORD);
    // From source: the provision service builds; nothing points it at a registry.
    assert.equal(env.CIELE_PROVISION_IMAGE, "");
    assert.equal(env.CIELE_PROVISION_PULL_POLICY, "");
  });

  check("the port defaults to 5432 and a new URL replaces the coordinates but never the minted password", () => {
    const before = envNow();
    run("--database-url=postgres://other_admin:password@ep-cool.eu-central-1.aws.neon.tech/neondb");
    const env = envNow();
    assert.equal(env.EXTERNAL_DB_HOST, "ep-cool.eu-central-1.aws.neon.tech");
    assert.equal(env.EXTERNAL_DB_PORT, "5432");
    assert.equal(env.EXTERNAL_DB_NAME, "neondb");
    assert.equal(env.EXTERNAL_DB_ADMIN_USER, "other_admin");
    assert.equal(env.EXTERNAL_DB_SERVICE_PASSWORD, before.EXTERNAL_DB_SERVICE_PASSWORD, "the service logins already use it");
    assert.equal(env.COMPOSE_FILE, "docker-compose.yml:docker-compose.external-db.yml", "the overlay is listed once");
  });

  check("adding --images points the provision service at the published migrate image", () => {
    run("--images", "v9.9.9");
    const env = envNow();
    assert.equal(env.COMPOSE_FILE, "docker-compose.yml:docker-compose.external-db.yml:docker-compose.images.yml");
    assert.equal(env.CIELE_PROVISION_IMAGE, "ghcr.io/mattiaippoliti/ciele/migrate:v9.9.9");
    assert.equal(env.CIELE_PROVISION_PULL_POLICY, "always");
  });

  check("--db-ca copies the bundle beside the compose files and switches to verify-full (#814)", () => {
    const bundle = path.join(tmpExternal, "provider-ca.pem");
    const fakeCert = "-----BEGIN CERTIFICATE-----\nMIIBfake\n-----END CERTIFICATE-----\n";
    writeFileSync(bundle, fakeCert + fakeCert);
    run("--db-ca", "provider-ca.pem");
    const env = envNow();
    assert.equal(env.EXTERNAL_DB_SSLMODE, "verify-full");
    assert.equal(env.EXTERNAL_DB_CA_FILE, "./external-db/db-ca.pem");
    assert.equal(
      readFileSync(path.join(tmpExternal, "external-db", "db-ca.pem"), "utf8"),
      fakeCert + fakeCert,
      "the bundle must be copied verbatim (two roots in, two roots out)"
    );
    // Not a PEM: refused before anything is copied.
    writeFileSync(path.join(tmpExternal, "not-a-cert.txt"), "hello");
    assert.match(refused("--db-ca", "not-a-cert.txt"), /PEM/);
    assert.match(refused("--db-ca", "missing.pem"), /not a file/);
  });

  check("bootstrap refuses, before any container, the URLs the stack cannot run on", () => {
    // Each refusal names the problem: the operator gets a sentence, not a
    // crash-looping container ten minutes later.
    assert.match(refused("--database-url", "postgresql://a:password@ep-x-pooler.eu-central-1.aws.neon.tech/db"), /pooler/);
    assert.match(refused("--database-url", "postgresql://postgres:password@db.abcdefgh.supabase.co:5432/postgres"), /hosted Supabase project/);
    assert.match(refused("--database-url", "postgresql://a:password@host/db?sslmode=disable"), /sslmode=disable/);
    assert.match(refused("--database-url", "postgresql://a@host/db"), /password/);
    assert.match(refused("--database-url", "postgresql://a:password@host"), /database name/);
    assert.match(refused("--database-url", "mysql://a:b@host/db"), /postgresql:\/\//);
    assert.match(refused("--database-url", "postgresql://a:password@word@host/db"), /Percent-encode/);
  });
} finally {
  rmSync(tmpExternal, { recursive: true, force: true });
}

check("one CA variable reaches every database client in the external-db overlay (#814)", () => {
  // Five containers open a connection: provision, auth, rest, storage and the
  // applier. Each mounts the same file at the same path; the URL consumers get
  // sslrootcert= from the `:+` expansion and the Node one gets
  // NODE_EXTRA_CA_CERTS. A client left out would fail verify-full alone, late.
  for (const service of ["provision", "auth", "rest", "storage", "migrate"]) {
    assert.match(
      externalDbSection(service),
      /^ {6}- \$\{EXTERNAL_DB_CA_FILE:-\.\/external-db\/no-ca\.pem\}:\/certs\/db-ca\.pem:ro$/m,
      `${service} must mount the CA bundle read-only at /certs/db-ca.pem`
    );
  }
  assert.match(externalDbSection("storage"), /^ {6}NODE_EXTRA_CA_CERTS: \$\{EXTERNAL_DB_CA_FILE:\+\/certs\/db-ca\.pem\}$/m);
  // The placeholder the mount falls back to must exist, or `up` fails on a
  // missing host path the moment nobody passed --db-ca.
  assert.ok(read("external-db/no-ca.pem").length > 0, "external-db/no-ca.pem must exist");
  assert.match(envExample, /^EXTERNAL_DB_CA_FILE=$/m);
});

check("the provisioner enforces what the services silently assume", () => {
  const sql = read("external-db/provision.sql");
  const entrypoint = read("provision-entrypoint.sh");
  // Postgres 16+: below it no non-superuser can create a BYPASSRLS role.
  assert.match(sql, /server_version_num'\)::int;[\s\S]*?if v < 160000 then[\s\S]*?raise exception/);
  assert.match(entrypoint, /-lt 160000/);
  // service_role must end up BYPASSRLS, or the install fails now rather than
  // serving RLS-gated service-key reads later.
  assert.match(sql, /create role service_role nologin inherit bypassrls/);
  assert.match(sql, /alter role service_role bypassrls/);
  assert.match(sql, /exception when insufficient_privilege then\s+raise exception using\s+message = format\('cannot give role service_role BYPASSRLS/);
  // Every role the three services and the chain name by hand.
  for (const role of [
    "anon",
    "authenticated",
    "authenticator",
    "supabase_auth_admin",
    "supabase_storage_admin",
    "postgres",
  ]) {
    assert.match(sql, new RegExp(`rolname = '${role}'`), `provision.sql must guard/create role ${role}`);
  }
  // GoTrue's search_path trap, the storage owner's membership for set_config('role').
  assert.match(sql, /alter role supabase_auth_admin set search_path = 'auth'/);
  assert.match(sql, /grant authenticator to supabase_storage_admin/);
  // The schemas and helpers the image used to create, owned by the services.
  assert.match(sql, /create schema if not exists auth authorization supabase_auth_admin/);
  assert.match(sql, /create schema if not exists storage authorization supabase_storage_admin/);
  assert.match(sql, /create schema if not exists extensions/);
  for (const fn of ["uid", "role", "email", "jwt"]) {
    assert.match(sql, new RegExp(`alter function auth\\.${fn}\\(\\) +owner to supabase_auth_admin`));
  }
  // The chain's two extensions, created up front so its own copies are no-ops.
  assert.match(sql, /create extension if not exists vector;/);
  assert.match(sql, /create extension if not exists pg_trgm with schema extensions;/);
  // A pooler hostname or a hosted Supabase project is refused before connecting.
  assert.match(entrypoint, /\*-pooler\.\*/);
  assert.match(entrypoint, /db\.\*\.supabase\.co/);
});

console.log(`\n${passed} checks passed.`);
