import { describe, expect, it } from "vitest";
import {
  SALES_LEAD_LIMITS,
  salesLeadEmail,
  validateSalesLead,
  type SalesLeadSubmission,
} from "./sales-lead";

function submission(patch: Partial<SalesLeadSubmission> = {}): SalesLeadSubmission {
  return {
    email: "dean@example.edu",
    name: "Ada Lovelace",
    phone: "",
    country: "Italy",
    website: "",
    size: "",
    interest: "",
    message: "",
    consent: true,
    ...patch,
  };
}

describe("validateSalesLead", () => {
  it("accepts a minimal submission and stamps the consent instant", () => {
    const at = new Date("2026-08-05T10:00:00.000Z");
    const result = validateSalesLead(submission(), at);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.lead.consent).toBe(true);
    expect(result.lead.consentAt).toBe("2026-08-05T10:00:00.000Z");
  });

  it("trims every text field", () => {
    const result = validateSalesLead(
      submission({ name: "  Ada  ", message: "  hello  " })
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.lead.name).toBe("Ada");
    expect(result.lead.message).toBe("hello");
  });

  it("rejects a missing consent, the toggle is not the only gate", () => {
    const result = validateSalesLead(submission({ consent: false }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.consent).toBeTruthy();
  });

  it("rejects a consent that is truthy but not boolean true", () => {
    const result = validateSalesLead({ ...submission(), consent: "yes" });
    expect(result.ok).toBe(false);
  });

  it.each([["nope"], ["a@b"], ["two @signs@x.com"], [""]])(
    "rejects the email %j",
    (email) => {
      const result = validateSalesLead(submission({ email }));
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.errors.email).toBeTruthy();
    }
  );

  it("rejects a country outside the offered list", () => {
    const result = validateSalesLead(submission({ country: "Atlantis" }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.country).toBeTruthy();
  });

  it("rejects a size or interest outside the offered list", () => {
    expect(validateSalesLead(submission({ size: "one zillion" })).ok).toBe(false);
    expect(validateSalesLead(submission({ interest: "Mind control" })).ok).toBe(false);
  });

  it("leaves size and interest optional", () => {
    expect(validateSalesLead(submission({ size: "", interest: "" })).ok).toBe(true);
  });

  it("normalizes a bare hostname into an absolute https URL", () => {
    const result = validateSalesLead(submission({ website: "example.edu" }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.lead.website).toBe("https://example.edu/");
  });

  it("refuses a non-http scheme in the website field", () => {
    const result = validateSalesLead(
      submission({ website: "javascript:alert(1)" })
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.website).toBeTruthy();
  });

  it("caps the message so the one public write cannot carry a megabyte", () => {
    const result = validateSalesLead(
      submission({ message: "x".repeat(SALES_LEAD_LIMITS.message + 1) })
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.message).toBeTruthy();
  });

  it("reports every bad field at once, not just the first", () => {
    const result = validateSalesLead(
      submission({ email: "", name: "", country: "Atlantis", consent: false })
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(Object.keys(result.errors).sort()).toEqual([
      "consent",
      "country",
      "email",
      "name",
    ]);
  });
});

describe("salesLeadEmail", () => {
  const lead = validateSalesLead(
    submission({
      phone: "+39 06 000",
      website: "https://example.edu/",
      size: "1 to 500",
      interest: "Analytics & insights",
      message: "We run 40 courses.",
    }),
    new Date("2026-08-05T10:00:00.000Z")
  );

  it("carries the consent value and its timestamp, the mail is the record", () => {
    expect(lead.ok).toBe(true);
    if (!lead.ok) return;
    const mail = salesLeadEmail(lead.lead, { to: "sales@ciele.app" });
    expect(mail.body).toContain(
      "Marketing consent: granted at 2026-08-05T10:00:00.000Z"
    );
  });

  it("replies to the enquirer, not the alias", () => {
    if (!lead.ok) return;
    const mail = salesLeadEmail(lead.lead, { to: "sales@ciele.app" });
    expect(mail.to).toBe("sales@ciele.app");
    expect(mail.replyTo).toBe("dean@example.edu");
    expect(mail.subject).toContain("dean@example.edu");
  });

  it("includes every collected field", () => {
    if (!lead.ok) return;
    const mail = salesLeadEmail(lead.lead, {
      to: "sales@ciele.app",
      sourceUrl: "https://ciele.app/contact/sales",
    });
    for (const fragment of [
      "Ada Lovelace",
      "+39 06 000",
      "Italy",
      "https://example.edu/",
      "1 to 500",
      "Analytics & insights",
      "We run 40 courses.",
      "https://ciele.app/contact/sales",
    ]) {
      expect(mail.body).toContain(fragment);
    }
  });
});
