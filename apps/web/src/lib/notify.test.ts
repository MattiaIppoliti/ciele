import { describe, expect, it } from "vitest";
import { improvementAssignedEmail, improvementClosedEmail } from "./notify";

/**
 * Improvement notification templates: pure builders that produce the shared
 * EmailMessage the one transport (sendEmail) delivers.
 */

describe("improvement notification templates", () => {
  it("builds an assignment email addressed to the assignee", () => {
    const msg = improvementAssignedEmail({
      to: "assignee@uni.it",
      key: "IMP-7",
      title: "Fix the enrollment answer",
      actorEmail: "owner@uni.it",
    });
    expect(msg.to).toBe("assignee@uni.it");
    expect(msg.subject).toBe("You were assigned IMP-7: Fix the enrollment answer");
    expect(msg.body).toContain("owner@uni.it");
    expect(msg.body).toContain("IMP-7");
  });

  it("builds a closure email naming the resolved item", () => {
    const msg = improvementClosedEmail({
      to: "reporter@uni.it",
      key: "IMP-7",
      title: "Fix the enrollment answer",
      actorEmail: "owner@uni.it",
    });
    expect(msg.to).toBe("reporter@uni.it");
    expect(msg.subject).toBe("IMP-7 was resolved: Fix the enrollment answer");
    expect(msg.body).toContain("done");
  });
});
