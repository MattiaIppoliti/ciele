import { describe, expect, it } from "vitest";
import { ANALYTICS_EXPORTS_BUCKET, exportObjectPath } from "./exports";

describe("export artifact storage helpers", () => {
  it("writes to the private analytics bucket", () => {
    expect(ANALYTICS_EXPORTS_BUCKET).toBe("analytics-exports");
  });

  it("builds tenant-scoped, job-stable object paths", () => {
    expect(
      exportObjectPath({
        organizationId: "org_123",
        jobId: "job_abc",
        format: "csv",
      })
    ).toBe("org/org_123/exports/job_abc.csv");
  });
});
