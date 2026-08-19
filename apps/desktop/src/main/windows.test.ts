// The two pure functions behind the "Ciele did not load" screen.
//
// `showProduct` itself needs a real BrowserWindow, so it is the smoke's job.
// What is worth testing here is the wording: these strings are the entire
// difference between a user fixing their address and a user filing a bug.

import { describe, expect, it } from "vitest";
import { httpFailureReason, loadFailureReason, partitionForMode } from "./failure-reasons";

describe("loadFailureReason", () => {
  it("tells a typo apart from a server that is down", () => {
    // Same symptom, opposite fixes. Getting this backwards sends someone to
    // restart a healthy server, or to re-read a correct address.
    expect(loadFailureReason(-105, "")).toMatch(/does not exist/i);
    expect(loadFailureReason(-102, "")).toMatch(/nothing is listening/i);
  });

  it("says plainly when the machine is offline", () => {
    expect(loadFailureReason(-106, "")).toMatch(/offline/i);
  });

  it("explains a port the browser itself refuses, rather than blaming the server", () => {
    // Chromium blocks a list of ports outright, so a self-hoster who picks one
    // gets a failure that has nothing to do with their server.
    expect(loadFailureReason(-312, "")).toMatch(/port/i);
  });

  it("names a timeout and a bad certificate as themselves", () => {
    expect(loadFailureReason(-7, "")).toMatch(/too long/i);
    expect(loadFailureReason(-501, "")).toMatch(/certificate/i);
  });

  it("falls back to Chromium's own words rather than saying nothing", () => {
    expect(loadFailureReason(-999, "ERR_WEIRD")).toContain("ERR_WEIRD");
  });

  it("still produces a sentence when there are no words to fall back on", () => {
    expect(loadFailureReason(-999, "")).toMatch(/could not be reached/i);
  });
});

describe("httpFailureReason", () => {
  const origin = "https://ciele.example.edu";

  it("passes a healthy response through", () => {
    expect(httpFailureReason(200, origin)).toBeNull();
    expect(httpFailureReason(302, origin)).toBeNull();
  });

  it("catches a hostname parked with nothing behind it", () => {
    // The bug this exists for: a domain pointed at a host with no deployment
    // answers 404 for `/`, and the user sees the provider's error page inside
    // a window with no address bar.
    expect(httpFailureReason(404, origin)).toContain("no Ciele there");
    expect(httpFailureReason(404, origin)).toContain(origin);
  });

  it("treats a sign-in wall as normal, because it is", () => {
    // A self-hosted deployment behind SSO or basic auth answers 401/403 first.
    // Calling that unreachable would lock those users out of their own server.
    expect(httpFailureReason(401, origin)).toBeNull();
    expect(httpFailureReason(403, origin)).toBeNull();
  });

  it("says a server error is probably temporary", () => {
    expect(httpFailureReason(503, origin)).toMatch(/try again/i);
  });

  it("reports any other refusal with its status", () => {
    expect(httpFailureReason(418, origin)).toContain("418");
  });
});

describe("partitionForMode", () => {
  it("keeps a hosted account and a local stack in separate sessions", () => {
    expect(partitionForMode("saas")).not.toBe(partitionForMode("local"));
    // `persist:` is what makes the session outlive the window.
    expect(partitionForMode("saas")).toMatch(/^persist:/);
  });
});
