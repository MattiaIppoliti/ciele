import { describe, expect, it, vi } from "vitest";
import { createSetupEngine } from "./engine";
import { fakePorts } from "./testing/fake-ports";
import type { SetupStep, VerifyResult } from "./types";
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

/** A step whose execute and verify are whatever the test needs them to be. */
function step(
  id: string,
  overrides: Partial<SetupStep> & { verifyResult?: VerifyResult } = {},
): SetupStep {
  const { verifyResult, ...rest } = overrides;
  return {
    id,
    title: id,
    description: `step ${id}`,
    execute: async () => {},
    verify: async () => verifyResult ?? { ok: true },
    ...rest,
  };
}

function engineWith(steps: SetupStep[]) {
  return createSetupEngine({ steps, ports: fakePorts(), config: CONFIG });
}

describe("ordering", () => {
  it("runs the steps in order and stops when all have passed", async () => {
    const order: string[] = [];
    const engine = engineWith([
      step("a", { execute: async () => void order.push("a") }),
      step("b", { execute: async () => void order.push("b") }),
      step("c", { execute: async () => void order.push("c") }),
    ]);

    const snapshot = await engine.run();

    expect(order).toEqual(["a", "b", "c"]);
    expect(snapshot.complete).toBe(true);
    expect(snapshot.steps.map((s) => s.status)).toEqual(["done", "done", "done"]);
  });

  it("passes what one step leaves in the bag to the next", async () => {
    let seen: string | undefined;
    const engine = engineWith([
      step("a", { execute: async (ctx) => void (ctx.bag.envPath = "/data/.env") }),
      step("b", { execute: async (ctx) => void (seen = ctx.bag.envPath) }),
    ]);

    await engine.run();

    expect(seen).toBe("/data/.env");
    expect(engine.bag()).toEqual({ envPath: "/data/.env" });
  });
});

describe("verify gates the next step", () => {
  it("does not start the next step when verify says the work did not land", async () => {
    const later = vi.fn();
    const engine = engineWith([
      step("a", { verifyResult: { ok: false, detail: "Docker is not running." } }),
      step("b", { execute: later }),
    ]);

    const snapshot = await engine.run();

    expect(later).not.toHaveBeenCalled();
    expect(snapshot.steps.map((s) => s.status)).toEqual(["failed", "pending"]);
    expect(snapshot.steps[0]!.error).toBe("Docker is not running.");
    expect(snapshot.complete).toBe(false);
  });

  it("fails the step even when execute itself was perfectly happy", async () => {
    // The whole reason verify exists: `docker compose up` exits 0 long before
    // the stack is actually serving anything.
    const execute = vi.fn(async () => {});
    const engine = engineWith([step("a", { execute, verifyResult: { ok: false } })]);

    const snapshot = await engine.run();

    expect(execute).toHaveBeenCalledOnce();
    expect(snapshot.steps[0]!.status).toBe("failed");
    expect(snapshot.steps[0]!.error).toContain("could not be verified");
  });

  it("carries a verify's help link through, so a failure has somewhere to go", async () => {
    const help = { label: "Get Docker Desktop", url: "https://example.invalid/docker" };
    const engine = engineWith([step("a", { verifyResult: { ok: false, detail: "no", help } })]);

    const snapshot = await engine.run();

    expect(snapshot.steps[0]!.help).toEqual(help);
  });
});

describe("failure and retry", () => {
  it("reports what execute threw", async () => {
    const engine = engineWith([
      step("a", {
        execute: async () => {
          throw new Error("Could not reach the registry.");
        },
      }),
    ]);

    const snapshot = await engine.run();

    expect(snapshot.steps[0]!.status).toBe("failed");
    expect(snapshot.steps[0]!.error).toBe("Could not reach the registry.");
  });

  it("keeps the failed step's logs, which are the only clue the user has", async () => {
    const engine = engineWith([
      step("a", {
        execute: async (ctx) => {
          ctx.log("pulling app…");
          ctx.log("manifest unknown");
          throw new Error("Pull failed.");
        },
      }),
    ]);

    const snapshot = await engine.run();

    expect(snapshot.steps[0]!.logs).toEqual(["pulling app…", "manifest unknown"]);
  });

  it("retries from the failed step without re-running the ones that passed", async () => {
    const first = vi.fn(async () => {});
    let attempts = 0;
    const engine = engineWith([
      step("a", { execute: first }),
      step("b", {
        execute: async () => {
          attempts++;
          if (attempts === 1) throw new Error("Transient.");
        },
      }),
      step("c"),
    ]);

    await engine.run();
    expect(engine.snapshot().steps.map((s) => s.status)).toEqual([
      "done",
      "failed",
      "pending",
    ]);

    const snapshot = await engine.retry();

    expect(first).toHaveBeenCalledOnce();
    expect(attempts).toBe(2);
    expect(snapshot.steps.map((s) => s.status)).toEqual(["done", "done", "done"]);
    expect(snapshot.complete).toBe(true);
  });

  it("clears the previous attempt's logs on retry", async () => {
    let attempts = 0;
    const engine = engineWith([
      step("a", {
        execute: async (ctx) => {
          attempts++;
          ctx.log(`attempt ${attempts}`);
          if (attempts === 1) throw new Error("nope");
        },
      }),
    ]);

    await engine.run();
    const snapshot = await engine.retry();

    expect(snapshot.steps[0]!.logs).toEqual(["attempt 2"]);
  });

  it("stays failed when the retry fails again", async () => {
    const engine = engineWith([
      step("a", {
        execute: async () => {
          throw new Error("Still broken.");
        },
      }),
    ]);

    await engine.run();
    const snapshot = await engine.retry();

    expect(snapshot.steps[0]!.status).toBe("failed");
    expect(snapshot.steps[0]!.error).toBe("Still broken.");
  });
});

describe("optional steps", () => {
  it("stops in front of an optional step instead of running it unasked", async () => {
    // "Optional" that happens to you anyway is not optional. The run halts,
    // the wizard asks, and only then does the step run.
    const unasked = vi.fn(async () => {});
    const engine = engineWith([step("a"), step("b", { optional: true, execute: unasked })]);

    const snapshot = await engine.run();

    expect(unasked).not.toHaveBeenCalled();
    expect(snapshot.awaitingDecision).toBe(true);
    expect(snapshot.currentIndex).toBe(1);
    expect(snapshot.steps.map((s) => s.status)).toEqual(["done", "pending"]);
  });

  it("runs the optional step once the user accepts it", async () => {
    const accepted = vi.fn(async () => {});
    const engine = engineWith([step("a"), step("b", { optional: true, execute: accepted })]);

    await engine.run();
    const snapshot = await engine.run();

    expect(accepted).toHaveBeenCalledOnce();
    expect(snapshot.complete).toBe(true);
  });

  it("skips past an optional step that failed, and still completes", async () => {
    // The reason optional steps exist: the demo seed or a model key can fail
    // and the install is still a working product.
    const engine = engineWith([
      step("a"),
      step("b", { optional: true, verifyResult: { ok: false, detail: "no model server" } }),
      step("c"),
    ]);
    await engine.run();
    await engine.run(); // accepted, and it fails
    expect(engine.snapshot().steps.map((s) => s.status)).toEqual([
      "done",
      "failed",
      "pending",
    ]);

    const snapshot = await engine.skip();

    expect(snapshot.steps.map((s) => s.status)).toEqual(["done", "skipped", "done"]);
    expect(snapshot.steps[1]!.error).toBeNull();
    expect(snapshot.complete).toBe(true);
  });

  it("refuses to skip a required step", async () => {
    const engine = engineWith([step("a", { verifyResult: { ok: false } }), step("b")]);
    await engine.run();

    await expect(engine.skip()).rejects.toThrow(/cannot be skipped/);
    expect(engine.snapshot().steps[0]!.status).toBe("failed");
  });
});

describe("input", () => {
  it("hands the user's values to the step that asked for them", async () => {
    let seen: Record<string, string> | undefined;
    const engine = engineWith([
      step("model", {
        fields: [{ id: "apiKey", label: "API key", secret: true }],
        execute: async (ctx) => void (seen = { ...ctx.input }),
      }),
    ]);

    engine.setInput("model", { apiKey: "sk-test" });
    await engine.run();

    expect(seen).toEqual({ apiKey: "sk-test" });
  });

  it("refuses input for a step that does not exist", () => {
    const engine = engineWith([step("a")]);
    expect(() => engine.setInput("nope", {})).toThrow(/No such step/);
  });
});

describe("subscription and reset", () => {
  it("pushes a snapshot on every transition, so the wizard can animate them", async () => {
    const seen: string[][] = [];
    const engine = engineWith([step("a"), step("b")]);
    engine.subscribe((s) => seen.push(s.steps.map((step) => step.status)));

    await engine.run();

    expect(seen).toContainEqual(["running", "pending"]);
    expect(seen).toContainEqual(["done", "running"]);
    expect(seen.at(-1)).toEqual(["done", "done"]);
  });

  it("reset returns to a clean first run", async () => {
    const engine = engineWith([step("a")]);
    await engine.run();

    const snapshot = engine.reset();

    expect(snapshot.steps[0]!.status).toBe("pending");
    expect(snapshot.complete).toBe(false);
    expect(engine.bag()).toEqual({});
  });

  it("ignores a second run while one is in flight", async () => {
    let resolve!: () => void;
    const gate = new Promise<void>((r) => (resolve = r));
    const execute = vi.fn(async () => {
      await gate;
    });
    const engine = engineWith([step("a", { execute })]);

    const first = engine.run();
    const second = engine.run();
    resolve();
    await Promise.all([first, second]);

    expect(execute).toHaveBeenCalledOnce();
  });
});

describe("revisiting a choice", () => {
  it("puts a skipped optional step back on the table", async () => {
    const ran = vi.fn(async () => {});
    const engine = engineWith([
      step("a"),
      step("b", { optional: true, execute: ran }),
      step("c"),
    ]);
    await engine.run();
    await engine.skip();
    expect(engine.snapshot().complete).toBe(true);

    const snapshot = engine.revisit("b");

    expect(snapshot.steps[1]!.status).toBe("pending");
    expect(snapshot.currentIndex).toBe(1);
    expect(snapshot.awaitingDecision).toBe(true);
    expect(snapshot.complete).toBe(false);

    await engine.run();
    expect(ran).toHaveBeenCalledOnce();
    expect(engine.snapshot().complete).toBe(true);
  });

  it("leaves the steps after it alone", async () => {
    // Reconsidering the demo content must not undo the model settings you
    // went on to enter.
    const engine = engineWith([
      step("a"),
      step("b", { optional: true }),
      step("c", { optional: true }),
    ]);
    await engine.run();
    await engine.run();
    await engine.run();
    expect(engine.snapshot().steps.map((s) => s.status)).toEqual(["done", "done", "done"]);

    const snapshot = engine.revisit("b");

    expect(snapshot.steps.map((s) => s.status)).toEqual(["done", "pending", "done"]);
  });

  it("keeps what the user already typed into it", async () => {
    // Coming back to a step to adjust one field should not empty the rest.
    const seen: Array<Record<string, string>> = [];
    const engine = engineWith([
      step("model", {
        optional: true,
        fields: [{ id: "apiKey", label: "API key" }],
        execute: async (ctx) => void seen.push({ ...ctx.input }),
      }),
    ]);
    engine.setInput("model", { apiKey: "sk-test" });
    await engine.run();

    engine.revisit("model");
    await engine.run();

    expect(seen).toEqual([{ apiKey: "sk-test" }, { apiKey: "sk-test" }]);
  });

  it("refuses to revisit a required step", async () => {
    // Everything after it stands on its result; un-running it is a promise
    // this engine cannot honestly keep.
    const engine = engineWith([step("a"), step("b", { optional: true })]);
    await engine.run();

    expect(() => engine.revisit("a")).toThrow(/cannot be revisited/);
  });

  it("refuses a step that does not exist", () => {
    const engine = engineWith([step("a")]);
    expect(() => engine.revisit("nope")).toThrow(/No such step/);
  });
});
