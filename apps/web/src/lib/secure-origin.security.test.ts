import { describe, expect, it } from "vitest";
import { insecurePublicOriginReason } from "./secure-origin";

/**
 * #801, CYB-16: a production process must not start on a public plain-HTTP
 * origin unless the operator has said so by name. Every case is a function of
 * the environment only.
 */
describe("insecurePublicOriginReason", () => {
  it("refuses a production build whose public origin is http on a routable host", () => {
    for (const origin of [
      "http://ciele.example.edu",
      "http://192.168.1.20:3000",
      "http://10.0.0.5",
      "http://app.internal",
    ]) {
      expect(
        insecurePublicOriginReason({ NODE_ENV: "production", CIELE_PUBLIC_ORIGIN: origin }),
        origin
      ).toMatch(/plain HTTP/);
    }
  });

  it("reads NEXT_PUBLIC_APP_URL when CIELE_PUBLIC_ORIGIN is unset", () => {
    expect(
      insecurePublicOriginReason({
        NODE_ENV: "production",
        NEXT_PUBLIC_APP_URL: "http://ciele.example.edu",
      })
    ).toMatch(/ciele\.example\.edu/);
  });

  it("reads PUBLIC_URL, the variable a self-host actually sets", () => {
    // deploy/.env configures PUBLIC_URL and nothing else by default, so the
    // BIND_ADDRESS=0.0.0.0 + LAN address case reached the app only through
    // it, and the first cut never read it (#801 review, round 2).
    const reason = insecurePublicOriginReason({
      NODE_ENV: "production",
      PUBLIC_URL: "http://192.168.1.20:3000",
      CIELE_PUBLIC_ORIGIN: "",
    });
    expect(reason).toMatch(/192\.168\.1\.20/);
    expect(reason).toMatch(/PUBLIC_URL/);
  });

  it("boots the default loopback compose stack without the opt-out", () => {
    // What deploy/.env.example plus docker-compose.yml hand the container
    // when nothing has been edited: loopback PUBLIC_URL, the rest empty.
    for (const publicUrl of ["http://localhost:3000", "http://127.0.0.1:3000"]) {
      expect(
        insecurePublicOriginReason({
          NODE_ENV: "production",
          PUBLIC_URL: publicUrl,
          CIELE_PUBLIC_ORIGIN: "",
          CIELE_ALLOW_INSECURE_HTTP: "",
        }),
        publicUrl
      ).toBeNull();
    }
  });

  it("checks every configured origin, not the first one set", () => {
    // An https PUBLIC_URL does not make an http CIELE_PUBLIC_ORIGIN safe: the
    // newsletter link is built from the second one.
    const reason = insecurePublicOriginReason({
      NODE_ENV: "production",
      PUBLIC_URL: "https://ciele.example.edu",
      CIELE_PUBLIC_ORIGIN: "http://192.168.1.20:3000",
    });
    expect(reason).toMatch(/CIELE_PUBLIC_ORIGIN/);
  });

  it("lets loopback through: that is how every local stack runs", () => {
    for (const origin of [
      "http://localhost:3000",
      "http://127.0.0.1:3000",
      "http://[::1]:3000",
      "http://ciele.localhost",
    ]) {
      expect(
        insecurePublicOriginReason({ NODE_ENV: "production", CIELE_PUBLIC_ORIGIN: origin }),
        origin
      ).toBeNull();
    }
  });

  it("lets https, an unset origin, and an unparsable origin through", () => {
    expect(
      insecurePublicOriginReason({ NODE_ENV: "production", CIELE_PUBLIC_ORIGIN: "https://ciele.app" })
    ).toBeNull();
    expect(insecurePublicOriginReason({ NODE_ENV: "production" })).toBeNull();
    // Not this check's job: the origin parser elsewhere refuses to build links from it.
    expect(
      insecurePublicOriginReason({ NODE_ENV: "production", CIELE_PUBLIC_ORIGIN: "not a url" })
    ).toBeNull();
  });

  it("is a production-only rule, and the opt-out has to be exactly 1", () => {
    const insecure = { CIELE_PUBLIC_ORIGIN: "http://ciele.example.edu" };
    expect(insecurePublicOriginReason({ ...insecure, NODE_ENV: "development" })).toBeNull();
    expect(insecurePublicOriginReason({ ...insecure, NODE_ENV: "test" })).toBeNull();
    expect(
      insecurePublicOriginReason({ ...insecure, NODE_ENV: "production", CIELE_ALLOW_INSECURE_HTTP: "1" })
    ).toBeNull();
    expect(
      insecurePublicOriginReason({ ...insecure, NODE_ENV: "production", CIELE_ALLOW_INSECURE_HTTP: "true" })
    ).toMatch(/plain HTTP/);
  });
});
