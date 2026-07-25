import { describe, expect, it } from "vitest";
import { DEMO_ORG, getMockDb } from "@agent-hub/db";
import { listEscalationDesks } from "./escalation-desks";
import { channelSetupError } from "./support-channels";

const db = getMockDb();

const FORM = [
  {
    id: "email",
    type: "user_email" as const,
    label: "Email",
    required: true,
    showInForm: true,
  },
];

describe("listEscalationDesks — channel projection", () => {
  it("hides an email channel saved without a destination address", async () => {
    const desk = await db.createHelpDesk(DEMO_ORG.id, { name: "Projection Desk" });
    await db.createSupportChannel(desk.id, {
      kind: "email",
      name: "Broken email",
      config: {},
      form: FORM,
    });
    const configured = await db.createSupportChannel(desk.id, {
      kind: "email",
      name: "Working email",
      config: { destinationEmail: "help@example.com" },
      form: FORM,
    });

    const [projected] = await listEscalationDesks(db, DEMO_ORG.id, [desk.id]);
    expect(projected.channels.map((c) => c.id)).toEqual([configured.id]);
  });

  it("keeps an email channel with an emptied form actionable via mailto", async () => {
    const desk = await db.createHelpDesk(DEMO_ORG.id, { name: "Mailto Desk" });
    await db.createSupportChannel(desk.id, {
      kind: "email",
      name: "Email us",
      config: { destinationEmail: "help@example.com" },
      form: [],
    });

    const [projected] = await listEscalationDesks(db, DEMO_ORG.id, [desk.id]);
    expect(projected.channels).toHaveLength(1);
    expect(projected.channels[0].form).toBeNull();
    expect(projected.channels[0].target).toBe("mailto:help@example.com");
  });

  it("projects ticket/salesforce as info-only, api_endpoint as a submittable form (#315)", async () => {
    const desk = await db.createHelpDesk(DEMO_ORG.id, { name: "Inert Kinds Desk" });
    await db.createSupportChannel(desk.id, {
      kind: "ticket",
      name: "Open a ticket",
      config: {},
      form: FORM,
    });
    await db.createSupportChannel(desk.id, {
      kind: "salesforce_chat",
      name: "Chat handover",
      config: { url: "https://sf.example.com" },
    });
    await db.createSupportChannel(desk.id, {
      kind: "api_endpoint",
      name: "Webhook",
      config: {
        url: "https://api.example.com/escalate",
        authType: "bearer",
        bearerToken: "secret-token",
      },
    });

    const [projected] = await listEscalationDesks(db, DEMO_ORG.id, [desk.id]);
    expect(projected.channels).toHaveLength(3);
    // Widget-visible but non-actionable rows; no channel auth config (tokens,
    // credentials) ever leaves the server for any kind.
    for (const channel of projected.channels) {
      expect(channel).not.toHaveProperty("config");
    }
    const byKind = Object.fromEntries(projected.channels.map((c) => [c.kind, c]));
    expect(byKind.ticket.target).toBeNull();
    expect(byKind.ticket.form).toBeNull();
    expect(byKind.salesforce_chat.target).toBeNull();
    expect(byKind.salesforce_chat.form).toBeNull();
    // API-endpoint channels submit their form to the configured endpoint.
    expect(byKind.api_endpoint.target).toBeNull();
    expect(byKind.api_endpoint.form).not.toBeNull();
    expect(JSON.stringify(byKind.api_endpoint)).not.toContain("secret-token");
  });

  it("strips hidden and file fields from the visitor-facing form (#316)", async () => {
    const desk = await db.createHelpDesk(DEMO_ORG.id, { name: "Form Fields Desk" });
    await db.createSupportChannel(desk.id, {
      kind: "email",
      name: "Email us",
      config: { destinationEmail: "help@example.com" },
      form: [
        ...FORM,
        {
          id: "internal",
          type: "short_text" as const,
          label: "Internal note",
          showInForm: false,
        },
        { id: "attachment", type: "file" as const, label: "Attachment", showInForm: true },
      ],
    });

    const [projected] = await listEscalationDesks(db, DEMO_ORG.id, [desk.id]);
    expect(projected.channels[0].form?.fields.map((f) => f.id)).toEqual(["email"]);
  });
});

describe("channelSetupError", () => {
  it("requires a destination email on email channels", () => {
    expect(channelSetupError("email", {})).toBe("Destination email is required");
    expect(channelSetupError("email", { destinationEmail: "  " })).toBe(
      "Destination email is required"
    );
    expect(channelSetupError("email", { destinationEmail: "not-an-email" })).toBe(
      "Destination email must be a valid email address"
    );
    expect(
      channelSetupError("email", { destinationEmail: "help@example.com" })
    ).toBeNull();
  });

  it("requires a phone number beyond the dial code", () => {
    expect(channelSetupError("phone", {})).toBe("Phone number is required");
    expect(
      channelSetupError("phone", { phoneCountry: "IT", phoneNumber: "+39 " })
    ).toBe("Phone number is required");
    expect(
      channelSetupError("phone", { phoneCountry: "IT", phoneNumber: "+39 06 1234" })
    ).toBeNull();
  });

  it("requires a URL on live chat, external link and API endpoint channels", () => {
    expect(channelSetupError("live_chat", {})).toBe("Live chat URL is required");
    expect(channelSetupError("external_link", {})).toBe("Link URL is required");
    expect(channelSetupError("api_endpoint", {})).toBe(
      "API Endpoint URL is required"
    );
    expect(channelSetupError("live_chat", { url: "https://chat.example.com" })).toBeNull();
    expect(channelSetupError("external_link", { url: "https://example.com" })).toBeNull();
    expect(channelSetupError("api_endpoint", { url: "https://api.example.com" })).toBeNull();
  });

  it("has nothing to require on ticketing-backed kinds", () => {
    expect(channelSetupError("ticket", {})).toBeNull();
    expect(channelSetupError("salesforce_chat", {})).toBeNull();
  });
});
