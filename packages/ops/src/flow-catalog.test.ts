import { describe, expect, it } from "vitest";
import { DEMO_MEMBER, DEMO_ORG, getMockDb } from "@agent-hub/db";
import {
  FLOW_ACTIONS_WITH_SETTINGS,
  FLOW_CONDITION_KINDS,
  flowActionSchema,
  flowConditionLogicSchema,
  flowInputSchema,
} from "./flow-schema";
import { flowCatalogOp } from "./flows";

/**
 * `flows.catalog` is only worth serving if it cannot disagree with the schemas
 * the create endpoint validates against, so that is what these check: every
 * value the catalogue advertises has to be one the endpoint accepts, and the
 * pairing it reports has to be the pairing `assertTriggerActions` enforces.
 *
 * The lists are derived rather than restated, so these are really tests that
 * the derivation works. An empty `actionsWithSettings` would mean the endpoint
 * tells a caller nothing is configurable, which is worse than saying nothing.
 */

const catalogue = () =>
  flowCatalogOp.run(
    {
      organizationId: DEMO_ORG.id,
      userId: DEMO_MEMBER.userId,
      role: "viewer",
      db: getMockDb(),
    },
    {}
  );

describe("the served Flow catalogue", () => {
  it("advertises only values the create endpoint accepts", async () => {
    const result = await catalogue();
    for (const trigger of result.triggers) {
      expect(
        flowInputSchema.safeParse({ name: "probe", trigger: trigger.trigger })
          .success,
        trigger.trigger
      ).toBe(true);
    }
    for (const action of result.actions) {
      expect(flowActionSchema.safeParse(action).success, action).toBe(true);
    }
    for (const logic of result.conditionLogic) {
      expect(flowConditionLogicSchema.safeParse(logic).success, logic).toBe(true);
    }
  });

  it("names the condition kinds this build implements, and no others", async () => {
    const { conditionKinds } = await catalogue();
    expect(conditionKinds).toEqual([...FLOW_CONDITION_KINDS]);
    // The three charted-but-unbuilt kinds must not appear: a stored condition
    // of an unknown kind is skipped at routing time, so a Flow carrying one
    // matches everything instead of what its author asked for.
    for (const unbuilt of ["user_role", "external_data", "course"]) {
      expect(conditionKinds).not.toContain(unbuilt);
    }
  });

  it("names every action that takes settings", async () => {
    const { actionsWithSettings, actions } = await catalogue();
    expect(actionsWithSettings).toEqual([...FLOW_ACTIONS_WITH_SETTINGS]);
    expect(actionsWithSettings.length).toBeGreaterThan(0);
    for (const action of actionsWithSettings) {
      expect(actions).toContain(action);
    }
  });

  it("reports the pairing rule rather than making a caller discover it", async () => {
    const { triggers } = await catalogue();
    const byTrigger = new Map(triggers.map((row) => [row.trigger, row]));

    // Proactive: a Notification is unprompted by definition, and nothing else
    // makes sense with no message to answer.
    expect(byTrigger.get("page_load")?.allowedActions).toEqual(["notification"]);
    expect(byTrigger.get("message")?.allowedActions).not.toContain("notification");

    // The three kinds are reported, so a caller can tell an inbound HTTP Flow
    // from a chat one without inferring it from the trigger's name.
    expect(byTrigger.get("message")?.kind).toBe("message");
    expect(byTrigger.get("page_load")?.kind).toBe("proactive");
    expect(byTrigger.get("http_request")?.kind).toBe("http");
    expect(byTrigger.get("http_request")?.allowedActions).toContain("respond");
  });

  it("is a read a Viewer can make, and mutates nothing", () => {
    expect(flowCatalogOp.capability).toBe("member");
    expect(flowCatalogOp.entities({}, undefined as never)).toEqual([]);
  });
});
