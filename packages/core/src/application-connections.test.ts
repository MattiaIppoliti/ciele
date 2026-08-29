import { describe, expect, it } from "vitest";
import { applicationConnectionOwnerType } from "./application-connections";

describe("Application Connection ownership", () => {
  it.each(["salesforce", "servicenow", "slack"] as const)(
    "owns %s at the Organization",
    (provider) => {
      expect(applicationConnectionOwnerType(provider)).toBe("organization");
    }
  );

  it.each(["onedrive", "google_drive"] as const)(
    "owns %s at the authorizing Member",
    (provider) => {
      expect(applicationConnectionOwnerType(provider)).toBe("member");
    }
  );
});
