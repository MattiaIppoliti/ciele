import { describe, expect, it, vi } from "vitest";
import { checkForUpdate, noticeFor } from "./update-check";
import { DEV_VERSION } from "../shared/release";

const RELEASE = {
  tag_name: "v2.0.0",
  html_url: "https://example.invalid/releases/v2.0.0",
};

describe("noticeFor", () => {
  it("offers a newer release", () => {
    expect(noticeFor(RELEASE, "1.0.0", null)).toEqual({
      version: "v2.0.0",
      url: RELEASE.html_url,
    });
  });

  it("says nothing when the app is already current", () => {
    expect(noticeFor(RELEASE, "2.0.0", null)).toBeNull();
  });

  it("says nothing when the app is ahead of the latest release", () => {
    // A developer running an unreleased build should not be told to
    // downgrade.
    expect(noticeFor(RELEASE, "2.1.0", null)).toBeNull();
  });

  it("stays dismissed for the version the user dismissed", () => {
    expect(noticeFor(RELEASE, "1.0.0", "v2.0.0")).toBeNull();
  });

  it("speaks up again for a release newer than the dismissed one", () => {
    expect(noticeFor({ tag_name: "v3.0.0" }, "1.0.0", "v2.0.0")).not.toBeNull();
  });

  it("ignores drafts and pre-releases", () => {
    // Neither is something to send a beta user to.
    expect(noticeFor({ ...RELEASE, draft: true }, "1.0.0", null)).toBeNull();
    expect(noticeFor({ ...RELEASE, prerelease: true }, "1.0.0", null)).toBeNull();
  });

  it("falls back to the releases page when the payload has no link", () => {
    const notice = noticeFor({ tag_name: "v2.0.0" }, "1.0.0", null);
    expect(notice?.url).toContain("/releases/latest");
  });

  it("ignores a payload with no tag at all", () => {
    expect(noticeFor({}, "1.0.0", null)).toBeNull();
    expect(noticeFor({ tag_name: 42 }, "1.0.0", null)).toBeNull();
  });
});

describe("checkForUpdate", () => {
  it("returns the notice for a newer release", async () => {
    const fetchImpl = vi.fn(async () => Response.json(RELEASE));

    expect(await checkForUpdate("1.0.0", null, fetchImpl as never)).toEqual({
      version: "v2.0.0",
      url: RELEASE.html_url,
    });
  });

  it("says nothing at all on an unreleased development build", async () => {
    // It is older than every release by definition, and the download it would
    // offer is not the build the developer is running.
    const fetchImpl = vi.fn(async () => Response.json(RELEASE));

    expect(await checkForUpdate(DEV_VERSION, null, fetchImpl as never)).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("fails silently offline, a plane is not an error state", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("getaddrinfo ENOTFOUND");
    });

    await expect(checkForUpdate("1.0.0", null, fetchImpl as never)).resolves.toBeNull();
  });

  it("fails silently when the API answers badly", async () => {
    // Rate limiting is the common one, and it must not become a dialog.
    const fetchImpl = vi.fn(async () => new Response("rate limited", { status: 403 }));

    await expect(checkForUpdate("1.0.0", null, fetchImpl as never)).resolves.toBeNull();
  });

  it("fails silently on a response that is not the JSON it expects", async () => {
    const fetchImpl = vi.fn(async () => new Response("<html>proxy login</html>"));

    await expect(checkForUpdate("1.0.0", null, fetchImpl as never)).resolves.toBeNull();
  });
});
