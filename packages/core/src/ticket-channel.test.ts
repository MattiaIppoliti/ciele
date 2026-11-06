import { describe, expect, it } from "vitest";
import type { ChannelFormField } from "./types";
import {
  filedTicketFromOutputs,
  ticketConnectorSettings,
  ticketFromForm,
  ticketingTargetIssue,
} from "./ticket-channel";

const form: ChannelFormField[] = [
  { id: "f-email", type: "user_email", label: "Email", required: true, useAsReplyTo: true },
  { id: "f-subject", type: "short_text", label: "Subject", required: true },
  { id: "f-desc", type: "long_text", label: "Description", required: true },
  { id: "f-dept", type: "dropdown", label: "Department", options: ["IT", "HR"] },
  { id: "f-hidden", type: "short_text", label: "Internal", showInForm: false },
];

const context = { assistantTitle: "Help bot", deskName: "IT desk", channelName: "Open a ticket" };

describe("ticketFromForm (#1088)", () => {
  it("maps the email, subject and description fields and keeps the rest as lines", () => {
    const draft = ticketFromForm(
      form,
      {
        "f-email": " ada@example.org ",
        "f-subject": "Laptop broken",
        "f-desc": "It does not boot.",
        "f-dept": "IT",
        "f-hidden": "never shown",
      },
      context
    );
    expect(draft.requesterEmail).toBe("ada@example.org");
    expect(draft.subject).toBe("Laptop broken");
    expect(draft.description).toBe(
      [
        "It does not boot.",
        "",
        "Department: IT",
        "",
        'Filed from "Help bot", IT desk / Open a ticket.',
      ].join("\n")
    );
    expect(draft.description).not.toContain("never shown");
  });

  it("rejects a description that would silently lose requested chat context", () => {
    expect(() => ticketFromForm(form, { "f-desc": "x".repeat(32_000) }, {
      ...context, summary: "The Visitor needs a refund.", transcript: "User: Please help me with a refund.",
    })).toThrow(/too long/i);
  });

  it("follows the description with the chat summary and the transcript when given", () => {
    const draft = ticketFromForm(
      form,
      { "f-email": "a@b.co", "f-subject": "S", "f-desc": "D" },
      { ...context, summary: "The Visitor cannot log in.", transcript: "User: hi\nAssistant: hello" }
    );
    expect(draft.description).toBe(
      [
        "D",
        "",
        "--- Chat summary ---",
        "The Visitor cannot log in.",
        "",
        "--- Conversation ---",
        "User: hi\nAssistant: hello",
        "",
        'Filed from "Help bot", IT desk / Open a ticket.',
      ].join("\n")
    );
  });

  it("falls back by field type when the labels were renamed, and to a desk subject", () => {
    const renamed: ChannelFormField[] = [
      { id: "e", type: "user_email", label: "Your address" },
      { id: "t", type: "long_text", label: "What happened?" },
    ];
    const draft = ticketFromForm(renamed, { e: "x@y.z", t: "Printer jam" }, context);
    expect(draft).toMatchObject({
      requesterEmail: "x@y.z",
      subject: "Support request, IT desk",
    });
    expect(draft.description.startsWith("Printer jam")).toBe(true);
  });

  it("rejects an oversized subject and accepts the exact Case field limits", () => {
    expect(() => ticketFromForm(form, { "f-subject": "x".repeat(256) }, context)).toThrow(/subject is too long/i);
    const footer = '\n\nFiled from "Help bot", IT desk / Open a ticket.';
    const draft = ticketFromForm(form, { "f-subject": "x".repeat(255), "f-desc": "x".repeat(32_000 - footer.length) }, context);
    expect(draft.subject).toHaveLength(255);
    expect(draft.description).toHaveLength(32_000);
    expect(draft.description).toContain(footer);
  });
});

describe("ticketConnectorSettings", () => {
  const draft = {
    subject: 'Quote " and {{user.name}}',
    description: "Body",
    requesterEmail: "ada@example.org",
    requesterName: "",
  };

  it("files a Salesforce Case through Create case, Origin Web", () => {
    expect(ticketConnectorSettings({ provider: "salesforce", connectionId: "c1" }, draft)).toEqual({
      provider: "salesforce",
      connectionId: "c1",
      action: "salesforce.case.create",
      params: {
        subject: 'Quote " and {{user.name}}',
        description: "Body",
        priority: "",
        status: "",
        origin: "Web",
        supplied_email: "ada@example.org",
        supplied_name: "",
      },
    });
  });

  it("files a ServiceNow record with the requester email in the column the admin picked", () => {
    const settings = ticketConnectorSettings(
      { provider: "servicenow", connectionId: "c2", table: "incident", requesterEmailField: "u_email" },
      draft
    );
    expect(settings).toMatchObject({ action: "servicenow.record.create", connectionId: "c2" });
    expect(settings.params?.table).toBe("incident");
    expect(JSON.parse(settings.params!.fields!)).toEqual({
      short_description: 'Quote " and {{user.name}}',
      description: "Body",
      u_email: "ada@example.org",
    });
  });

  it("puts the requester email in the description when no column is picked", () => {
    const settings = ticketConnectorSettings(
      { provider: "servicenow", connectionId: "c2", table: "" },
      draft
    );
    expect(settings.params?.table).toBe("incident");
    expect(JSON.parse(settings.params!.fields!)).toEqual({
      short_description: 'Quote " and {{user.name}}',
      description: "Body\n\nRequester email: ada@example.org",
    });
  });
});

describe("filedTicketFromOutputs", () => {
  it("reads each provider's outputs into one shape", () => {
    expect(
      filedTicketFromOutputs("salesforce", {
        case_id: "500x",
        case_number: "00001",
        case_url: "https://acme.my.salesforce.com/lightning/r/Case/500x/view",
      })
    ).toEqual({
      provider: "salesforce",
      id: "500x",
      number: "00001",
      url: "https://acme.my.salesforce.com/lightning/r/Case/500x/view",
    });
    expect(
      filedTicketFromOutputs("servicenow", { sys_id: "abc", number: "INC001", url: "https://x/y" })
    ).toEqual({ provider: "servicenow", id: "abc", number: "INC001", url: "https://x/y" });
  });
});

describe("ticketingTargetIssue", () => {
  const connection = {
    id: "c1",
    organizationId: "org-1",
    provider: "salesforce",
    ownerType: "organization",
    status: "connected",
  } as const;

  it("accepts an Organization-owned Connection of the target's provider", () => {
    expect(ticketingTargetIssue({ provider: "salesforce", connectionId: "c1" }, connection, "org-1")).toBeNull();
  });

  it("refuses a Member-owned, foreign, mismatched or missing Connection", () => {
    const target = { provider: "salesforce", connectionId: "c1" } as const;
    expect(ticketingTargetIssue(target, null, "org-1")).toMatch(/no longer exists/);
    expect(ticketingTargetIssue(target, connection, "org-2")).toMatch(/no longer exists/);
    expect(
      ticketingTargetIssue(target, { ...connection, ownerType: "member" }, "org-1")
    ).toMatch(/Organization-owned/);
    expect(
      ticketingTargetIssue({ ...target, provider: "servicenow", table: "incident" }, connection, "org-1")
    ).toMatch(/servicenow/);
  });

  it("refuses requester columns that overwrite the subject or description", () => {
    const sn = { ...connection, provider: "servicenow" } as const;
    for (const requesterEmailField of ["description", "short_description", "Description"]) {
      const target = { provider: "servicenow", connectionId: "c1", table: "incident", requesterEmailField } as const;
      expect(ticketingTargetIssue(target, sn, "org-1")).toMatch(/reserved/i);
      expect(() => ticketConnectorSettings(target, { subject: "Help", description: "Keep this", requesterEmail: "a@example.com", requesterName: "" })).toThrow(/reserved/i);
    }
  });

  it("refuses a table or column name that is not an identifier", () => {
    const sn = { ...connection, provider: "servicenow" } as const;
    expect(
      ticketingTargetIssue({ provider: "servicenow", connectionId: "c1", table: "incident;drop" }, sn, "org-1")
    ).toMatch(/table/i);
    expect(
      ticketingTargetIssue(
        { provider: "servicenow", connectionId: "c1", table: "incident", requesterEmailField: "a b" },
        sn,
        "org-1"
      )
    ).toMatch(/column/i);
  });
});
