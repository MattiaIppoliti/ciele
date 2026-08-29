import { describe, expect, it } from "vitest";
import type { EscalationChannel, EscalationHelpDesk } from "./escalation-desks";
import {
  escalationBack,
  escalationConfirmed,
  escalationLoaded,
  escalationOpenChannel,
  escalationOpenDesk,
  escalationScreen,
  loadingEscalationNav,
  type EscalationNav,
} from "./escalation-navigation";

function channel(id: string): EscalationChannel {
  return {
    id,
    kind: "email",
    name: `Channel ${id}`,
    availability: {
      mode: "always",
      timezone: "Europe/Rome",
      hours: {
        monday: { enabled: true, ranges: [] },
        tuesday: { enabled: true, ranges: [] },
        wednesday: { enabled: true, ranges: [] },
        thursday: { enabled: true, ranges: [] },
        friday: { enabled: true, ranges: [] },
        saturday: { enabled: false, ranges: [] },
        sunday: { enabled: false, ranges: [] },
      },
    },
    target: null,
    form: null,
  };
}

function desk(id: string, channels: EscalationChannel[] = []): EscalationHelpDesk {
  return { id, name: `Desk ${id}`, channels };
}

/** Two desks loaded, nothing entered: the desk list. */
function twoDesks(over: Partial<EscalationNav<string>> = {}): EscalationNav<string> {
  return {
    desks: [desk("d1"), desk("d2")],
    activeDesk: null,
    activeChannel: null,
    confirmation: null,
    ...over,
  };
}

describe("escalationLoaded", () => {
  it("auto-enters the only desk instead of showing a one-item list", () => {
    const only = desk("only");
    const nav = escalationLoaded(loadingEscalationNav, [only]);
    expect(nav.desks).toEqual([only]);
    expect(nav.activeDesk).toEqual(only);
  });

  it("auto-enters the desk the caller asked for", () => {
    const nav = escalationLoaded(
      loadingEscalationNav,
      [desk("d1"), desk("d2")],
      "d2"
    );
    expect(nav.activeDesk?.id).toBe("d2");
  });

  it("lands on the desk list when several desks and none was asked for", () => {
    const nav = escalationLoaded(loadingEscalationNav, [desk("d1"), desk("d2")]);
    expect(nav.activeDesk).toBeNull();
    expect(escalationScreen(nav)).toBe("desks");
  });

  it("treats a failed load as an empty desk list, never a stuck spinner", () => {
    expect(escalationScreen(escalationLoaded(loadingEscalationNav, []))).toBe(
      "empty"
    );
  });
});

describe("escalationScreen", () => {
  it("shows the loading spinner until the desks arrive", () => {
    expect(escalationScreen(loadingEscalationNav)).toBe("loading");
  });

  it("walks desks → channels → form → confirmation", () => {
    let nav = twoDesks();
    expect(escalationScreen(nav)).toBe("desks");
    nav = escalationOpenDesk(nav, desk("d1"));
    expect(escalationScreen(nav)).toBe("channels");
    nav = escalationOpenChannel(nav, channel("c1"));
    expect(escalationScreen(nav)).toBe("form");
    nav = escalationConfirmed(nav, "Thanks, we'll be in touch.");
    expect(escalationScreen(nav)).toBe("confirmation");
  });

  it("never hides a confirmation behind a refetch", () => {
    const nav = twoDesks({ desks: null, confirmation: "Sent" });
    expect(escalationScreen(nav)).toBe("confirmation");
  });
});

describe("escalationBack", () => {
  it("pops the confirmation back to the channel list, clearing the channel too", () => {
    const nav = twoDesks({
      activeDesk: desk("d1"),
      activeChannel: channel("c1"),
      confirmation: "Sent",
    });
    const next = escalationBack(nav);
    expect(next).not.toBeNull();
    expect(next!.confirmation).toBeNull();
    expect(next!.activeChannel).toBeNull();
    expect(escalationScreen(next!)).toBe("channels");
  });

  it("pops the form back to the channel list, keeping the desk", () => {
    const nav = twoDesks({ activeDesk: desk("d1"), activeChannel: channel("c1") });
    const next = escalationBack(nav);
    expect(next!.activeChannel).toBeNull();
    expect(next!.activeDesk?.id).toBe("d1");
    expect(escalationScreen(next!)).toBe("channels");
  });

  it("pops a desk's channels back to the desk list when there are several desks", () => {
    const next = escalationBack(twoDesks({ activeDesk: desk("d1") }));
    expect(next!.activeDesk).toBeNull();
    expect(escalationScreen(next!)).toBe("desks");
  });

  it("exits from an auto-entered single desk instead of showing a one-item list", () => {
    const only = desk("only");
    const nav = escalationLoaded(loadingEscalationNav, [only]);
    expect(escalationBack(nav)).toBeNull();
  });

  it("exits from the desk list and from an empty or unloaded state", () => {
    expect(escalationBack(twoDesks())).toBeNull();
    expect(escalationBack(twoDesks({ desks: [] }))).toBeNull();
    expect(escalationBack(loadingEscalationNav)).toBeNull();
  });

  it("leaves the state it was given untouched", () => {
    const nav = twoDesks({ activeDesk: desk("d1"), activeChannel: channel("c1") });
    escalationBack(nav);
    expect(nav.activeChannel?.id).toBe("c1");
  });
});

/**
 * The two rules that read the desk list differently (`escalationScreen` needs
 * only an entered desk, `escalationBack` needs more than one) agree because
 * `escalationLoaded` never leaves a single desk unentered. Pinned so a change
 * to the auto-entry rule fails here rather than surfacing as a one-item menu.
 */
describe("the single-desk invariant the two rules share", () => {
  it("never leaves one desk on the desk-list screen", () => {
    const nav = escalationLoaded(loadingEscalationNav, [desk("only")]);
    expect(escalationScreen(nav)).toBe("channels");
    expect(escalationBack(nav)).toBeNull();
  });

  it("shows the desk list, and returns to it, once there are two", () => {
    const nav = escalationLoaded(loadingEscalationNav, [desk("d1"), desk("d2")]);
    expect(escalationScreen(nav)).toBe("desks");
    const entered = escalationOpenDesk(nav, desk("d1"));
    expect(escalationScreen(entered)).toBe("channels");
    expect(escalationScreen(escalationBack(entered)!)).toBe("desks");
  });
});
