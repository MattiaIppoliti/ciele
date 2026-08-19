// The one Electron smoke.
//
// It asserts what only a running app can: the window opens on the welcome
// screen, both paths are reachable, the wizard drives its steps to completion,
// and a failing step shows what went wrong with a retry that recovers.
//
// Everything about *which* steps and *why* they gate is covered by the setup
// engine's unit tests. This is the seam between them and Electron.

import { expect, test, type ElectronApplication } from "@playwright/test";
import { launchApp } from "./launch";

test("opens on the welcome screen with both paths", async () => {
  const { app } = await launchApp();
  const window = await app.firstWindow();

  await expect(window.getByRole("heading", { name: "Welcome to Ciele" })).toBeVisible();
  await expect(window.getByRole("heading", { name: "Sign in to your organization" })).toBeVisible();
  await expect(window.getByRole("heading", { name: "Use locally (self-host)" })).toBeVisible();

  await app.close();
});

test("the settings screen carries the configurable server address", async () => {
  // The same path serves the hosted product and a remote self-hosted server;
  // this is the whole of that.
  const { app } = await launchApp();
  const window = await app.firstWindow();

  await window.getByRole("button", { name: "Settings" }).click();
  const field = window.getByRole("textbox", { name: /Server address/ });
  await expect(field).toHaveValue("https://ciele.app");

  await field.fill("ciele.example.edu/some/path");
  await window.getByRole("button", { name: "Save", exact: true }).click();

  // Normalised to an origin: a path on a base URL would be carried into
  // every navigation.
  await expect(field).toHaveValue("https://ciele.example.edu");
  await expect(window.getByText("Saved")).toBeVisible();

  await app.close();
});

/**
 * Wait for whichever window is currently showing a native screen with the
 * given test id on it.
 *
 * Native screens and the product live in different BrowserWindows, and moving
 * between them destroys one and builds the other, so a handle taken before a
 * mode change is stale after it, and even the window LIST is briefly stale
 * mid-swap. Hence: ask by content, tolerate a window vanishing underneath the
 * question, and try again.
 */
async function windowShowing(app: ElectronApplication, testId: string) {
  let found: Awaited<ReturnType<ElectronApplication["firstWindow"]>> | undefined;
  await expect
    .poll(
      async () => {
        for (const candidate of app.windows()) {
          try {
            if (await candidate.getByTestId(testId).isVisible()) {
              found = candidate;
              return true;
            }
          } catch {
            // That window was destroyed mid-swap; the next poll sees its
            // replacement.
          }
        }
        return false;
      },
      { timeout: 30_000 },
    )
    .toBe(true);
  return found!;
}

/** The address local mode pins, and the one the wizard's stack would serve. */
const LOCAL_ORIGIN = "http://localhost:3000";

/**
 * Evidence that the app pointed a product window at `origin`, by whichever of
 * the two outcomes actually happened.
 *
 * Whether that origin is served decides which evidence exists, and this must
 * not care. On CI nothing listens on 3000: the load fails in milliseconds and
 * the app falls back to its own screen naming the address. On a machine with
 * the web app already running, it loads and the window simply stays.
 *
 * Asserting only the loaded window is a race against that fallback, it
 * destroys the window a couple of hundred milliseconds in, while `expect.poll`
 * has already backed off to one-second intervals, so the check lands either
 * side of it. Asserting only the fallback breaks for a contributor with
 * `pnpm dev` up. Accepting either is deterministic in both.
 */
async function productOpenedAt(app: ElectronApplication, origin: string): Promise<void> {
  await expect
    .poll(
      async () => {
        // The settled outcome: it failed, and the app said so.
        for (const candidate of app.windows()) {
          try {
            const shown = candidate.getByTestId("unreachable-url");
            if (await shown.isVisible()) {
              if ((await shown.textContent())?.includes(origin)) return true;
            }
          } catch {
            // Destroyed mid-swap; the next poll sees its replacement.
          }
        }
        // The other outcome: it loaded, and is still sitting there.
        try {
          const urls = await app.evaluate(({ BrowserWindow }) =>
            BrowserWindow.getAllWindows().map((window) => window.webContents.getURL()),
          );
          return urls.some((url) => url.startsWith(origin));
        } catch {
          return false;
        }
      },
      { timeout: 30_000 },
    )
    .toBe(true);
}

test("sign-in follows the configured address, and says so when it does not load", async () => {
  // Two things at once, both offline-safe: the sign-in path points the product
  // window at whatever address is configured, and a page that fails comes back
  // to the app rather than stranding the user on a browser error in a window
  // with no address bar and no reload button.
  //
  // Asserting through the failure is what makes it deterministic, a test that
  // loaded the real hosted app would break on a plane, and did.
  //
  // A high port nothing listens on, and not one of the low ports Chromium
  // blocks outright, which would exercise a different message.
  const { app } = await launchApp();
  const window = await app.firstWindow();

  await window.getByRole("button", { name: "Settings" }).click();
  await window.getByRole("textbox", { name: /Server address/ }).fill("http://localhost:45999");
  await window.getByRole("button", { name: "Save", exact: true }).click();
  await window.getByRole("button", { name: "Back" }).click();
  await window.getByRole("button", { name: "Sign in" }).click();

  // The product window replaced this one, then handed back to a fresh native
  // window carrying the error.
  const recovered = await windowShowing(app, "unreachable-url");
  await expect(recovered.getByRole("heading", { name: "Ciele did not load" })).toBeVisible();
  // The address is on screen, because correcting it is the likely fix.
  await expect(recovered.getByTestId("unreachable-url")).toContainText("localhost:45999");
  await expect(recovered.getByTestId("unreachable-reason")).toContainText(/nothing is listening/i);
  // …and the fix is one click away.
  await expect(recovered.getByTestId("unreachable-settings")).toBeVisible();
  await expect(recovered.getByTestId("unreachable-retry")).toBeVisible();

  await app.close();
});

test("the local path runs the wizard through to a working stack", async () => {
  const { app } = await launchApp();
  const window = await app.firstWindow();

  await window.getByRole("button", { name: "Set up locally" }).click();

  // The required chain runs unattended and stops at the first choice.
  //
  // Only the destination is asserted, never a step along the way: the Docker
  // check runs no command, so it can pass before the first poll sees it. A
  // test that insisted on catching it would fail on a fast machine and pass on
  // a slow one, which is worse than not checking. `wizard-title` also stays
  // singular through a transition, which the step body does not.
  await expect(window.getByTestId("wizard-title")).toBeVisible();
  await expect(window.getByTestId("wizard-title")).toHaveText("Demo content", {
    timeout: 60_000,
  });

  // Optional means optional: declining both still finishes.
  await window.getByRole("button", { name: "Skip" }).click();
  await expect(window.getByTestId("wizard-title")).toHaveText("Connect an AI model");
  await window.getByRole("button", { name: "Skip" }).click();

  await expect(window.getByTestId("wizard-title")).toHaveText("Ready");
  await expect(window.getByTestId("open-ciele")).toBeVisible();

  // Day two, from the same window: the stack screen reports what is actually
  // there rather than what the wizard last did.
  await window.getByTestId("stack-status").click();
  await expect(window.getByRole("heading", { name: "Local stack" })).toBeVisible();
  await expect(window.getByTestId("stack-health")).toHaveText("Running");
  await window.getByRole("button", { name: "Stop" }).click();
  await expect(window.getByTestId("stack-health")).toHaveText("Stopped");
  await window.getByRole("button", { name: "Start" }).click();
  await expect(window.getByTestId("stack-health")).toHaveText("Running");

  // "Subsequent launches skip the wizard, until reset." This is the reset:
  // back in the wizard, and running the whole chain again rather than showing
  // the finished state it was left in.
  await window.getByTestId("reset-setup").click();
  await expect(window.getByTestId("wizard-title")).toBeVisible();
  await expect(window.getByTestId("wizard-title")).toHaveText("Demo content", {
    timeout: 60_000,
  });

  await app.close();
});

test("you can go back through the wizard, and reopen a choice you already made", async () => {
  const { app } = await launchApp();
  const window = await app.firstWindow();

  await window.getByRole("button", { name: "Set up locally" }).click();
  await expect(window.getByTestId("wizard-title")).toHaveText("Demo content", {
    timeout: 60_000,
  });

  // Back walks the steps that already ran, so a user can read what happened.
  await window.getByTestId("back").click();
  await expect(window.getByTestId("wizard-title")).toHaveText("Prepare the database");
  await window.getByTestId("back").click();
  await expect(window.getByTestId("wizard-title")).toHaveText("Start the stack");

  // A required step is history, not a decision: no offer to redo it.
  await expect(window.getByTestId("revisit")).toHaveCount(0);

  // Forward returns to where the engine actually is.
  await window.getByTestId("forward").click();
  await window.getByTestId("forward").click();
  await expect(window.getByTestId("wizard-title")).toHaveText("Demo content");
  await expect(window.getByTestId("continue")).toBeVisible();

  // Skip it, then change your mind, the point of Back having teeth.
  await window.getByRole("button", { name: "Skip" }).click();
  await expect(window.getByTestId("wizard-title")).toHaveText("Connect an AI model");
  await window.getByTestId("back").click();
  await expect(window.getByTestId("wizard-title")).toHaveText("Demo content");
  await window.getByTestId("revisit").click();

  // Back on the live step, offered again rather than silently skipped.
  await expect(window.getByTestId("wizard-title")).toHaveText("Demo content");
  await expect(window.getByTestId("continue")).toBeVisible();
  await window.getByTestId("continue").click();
  await expect(window.getByTestId("wizard-title")).toHaveText("Connect an AI model", {
    timeout: 60_000,
  });

  await app.close();
});

test("a build pins the release it came from, and says so when it has none", async () => {
  // No CIELE_IMAGE_TAG, so the tag can only come from the build's own version,
  // which is the whole of what this asserts.
  const { app } = await launchApp({ imageTag: null });
  const window = await app.firstWindow();

  // Which half applies is decided by whatever packaged this binary, so it is
  // asked rather than assumed. Every build except a release one is unstamped
  // and has no images to point at; the release workflow stamps a real version,
  // and that build pins it.
  //
  // Assuming the unstamped half is what broke the release run: it packages the
  // one build that IS stamped, so the guard the test waited on could never
  // fire, and it failed on a 30s timeout inside the release. Mirrors
  // `releaseVersion(isPackaged, reported)`: unpackaged is a dev build by
  // definition, whatever Electron reports for itself.
  const stamped = await app.evaluate(
    ({ app }) => app.isPackaged && app.getVersion() !== "0.0.0-dev",
  );

  await window.getByRole("button", { name: "Set up locally" }).click();

  if (stamped) {
    // It knows its own tag, so the pull is not where it stops: the chain runs
    // to the first optional step like any other run.
    await expect(window.getByTestId("wizard-title")).toHaveText("Demo content", {
      timeout: 60_000,
    });
  } else {
    // What a contributor running from source meets. The alternative is a
    // registry error against a tag that was never published, which reads as
    // "Ciele is broken".
    await expect(window.getByTestId("wizard-title")).toHaveText("Download Ciele", {
      timeout: 60_000,
    });
    const step = window.getByTestId("wizard-step").last();
    await expect(step.getByTestId("step-message")).toContainText("CIELE_IMAGE_TAG");
  }

  await app.close();
});

test("a failed step explains itself, shows its logs, and recovers on retry", async () => {
  // The path a user is most likely to meet and least likely to forgive being
  // wrong, so it is the one thing beyond the happy path this smoke drives.
  const { app } = await launchApp({ failOnce: "pull" });
  const window = await app.firstWindow();

  await window.getByRole("button", { name: "Set up locally" }).click();

  await expect(window.getByTestId("wizard-title")).toHaveText("Download Ciele", {
    timeout: 60_000,
  });
  // The last one: motion keeps the outgoing step mounted through its exit
  // animation, so the step being animated IN is the last in the DOM.
  const step = window.getByTestId("wizard-step").last();
  await expect(step.getByTestId("step-message")).toContainText("Could not download");

  await step.getByRole("button", { name: /Show details/ }).click();
  await expect(step.getByTestId("step-logs")).toContainText("simulated failure");

  await window.getByTestId("retry").click();

  await expect(window.getByTestId("wizard-title")).toHaveText("Demo content", {
    timeout: 60_000,
  });

  await app.close();
});

test("finishing setup opens the product window and later launches skip the wizard", async () => {
  const { app, userDataDir } = await launchApp();
  const window = await app.firstWindow();

  await window.getByRole("button", { name: "Set up locally" }).click();
  await expect(window.getByTestId("wizard-title")).toHaveText("Demo content", {
    timeout: 60_000,
  });
  await window.getByRole("button", { name: "Skip" }).click();
  await window.getByRole("button", { name: "Skip" }).click();
  await expect(window.getByTestId("open-ciele")).toBeVisible();

  await window.getByTestId("open-ciele").click();

  await productOpenedAt(app, LOCAL_ORIGIN);

  await app.close();

  // First-run cost is paid once: same settings directory, no wizard. Landing on
  // the local origin at all is the proof, the wizard points at no address, so
  // it could not have produced either outcome.
  const relaunched = await launchApp({ userDataDir });
  await productOpenedAt(relaunched.app, LOCAL_ORIGIN);
  await relaunched.app.close();
});
