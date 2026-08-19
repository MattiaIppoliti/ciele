// The stack controller against scripted ports.
//
// `createStackController` is importable without Electron: `registerStackHandlers`
// is the only thing in that module that touches `ipcMain`, and it is not what
// is tested here.

import { describe, expect, it } from "vitest";
import { createStackController } from "./stack";
import { fakePorts } from "../setup/testing/fake-ports";
import type { SetupConfig } from "../setup/ports";

const CONFIG: SetupConfig = {
  dataDir: "/data",
  deployDir: "/deploy",
  imageTag: "v1.2.3",
  appUrl: "http://localhost:3000",
  supabaseUrl: "http://localhost:8000",
  dockerDownloadUrl: "https://example.invalid/docker",
  composePathSeparator: ":",
};

function controllerWith(ports = fakePorts()) {
  const changes: string[] = [];
  const controller = createStackController(ports, CONFIG, (status) =>
    changes.push(status.health),
  );
  return { controller, ports, changes };
}

describe("health", () => {
  it("says Docker is unavailable rather than guessing about the stack", async () => {
    const { controller } = controllerWith(fakePorts({ dockerRunning: false }));

    expect((await controller.refresh()).health).toBe("docker-unavailable");
  });

  it("is stopped when nothing has been started", async () => {
    const { controller } = controllerWith();

    expect((await controller.refresh()).health).toBe("stopped");
  });

  it("is running only once Ciele actually answers", async () => {
    const { controller } = controllerWith();

    await controller.start();

    expect((await controller.refresh()).health).toBe("running");
  });

  it("is starting when the containers are up but nothing answers yet", async () => {
    // A container can be up and still replaying WAL, or crash-looping into a
    // restart. Reporting that as "running" would send the user to a dead page.
    const ports = fakePorts();
    const { controller } = controllerWith(ports);
    await controller.start();
    ports.probe.get = async () => null;

    expect((await controller.refresh()).health).toBe("starting");
  });
});

describe("start and stop", () => {
  it("starts the stack detached, so quitting the app leaves it running", async () => {
    const { controller, ports } = controllerWith();

    await controller.start();

    expect(ports.composeCalls.some((call) => call.includes("up -d"))).toBe(true);
  });

  it("stops rather than tears down, the user's data is not ours to remove", async () => {
    const { controller, ports } = controllerWith();
    await controller.start();

    await controller.stop();

    expect(ports.composeCalls.at(-2)).toContain("stop");
    for (const call of ports.composeCalls) {
      expect(call).not.toContain("down");
    }
  });

  it("reports why a start failed instead of silently staying stopped", async () => {
    const { controller } = controllerWith(fakePorts({ failOnce: ["up"] }));

    const status = await controller.start();

    expect(status.error).toContain("simulated failure");
    expect(status.busy).toBe(false);
  });

  it("clears the previous error when the next attempt works", async () => {
    const { controller } = controllerWith(fakePorts({ failOnce: ["up"] }));
    await controller.start();

    const status = await controller.start();

    expect(status.error).toBeNull();
    expect(status.health).toBe("running");
  });

  it("does not let a poll report the half-state mid-start", async () => {
    // The screen polls every few seconds; a refresh landing between `up` and
    // its verification would flicker the badge for no reason.
    const ports = fakePorts({ latencyMs: 30 });
    const { controller } = controllerWith(ports);

    const starting = controller.start();
    const mid = await controller.refresh();
    expect(mid.busy).toBe(true);
    await starting;

    expect(controller.status().health).toBe("running");
  });

  it("runs everything against the bundled definition and the generated env", async () => {
    const { controller, ports } = controllerWith();

    await controller.start();

    for (const call of ports.composeCalls) {
      expect(call).toContain("--env-file /data/.env");
      expect(call).toContain("-f /deploy/docker-compose.images.yml");
    }
  });

  it("pushes every change, so the screen never shows a stale badge", async () => {
    const { controller, changes } = controllerWith();

    await controller.start();

    expect(changes.length).toBeGreaterThan(0);
    expect(changes.at(-1)).toBe("running");
  });
});
