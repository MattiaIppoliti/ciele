import { describe, expect, it } from "vitest";
import {
  DEFAULT_CONNECTOR_PREFERENCES,
  connectorBaseUrl,
  connectorNeedsUpgrade,
  parseConnectorPairing,
  previewAiPreferencesKey,
  sanitizeConnectorStatus,
  sanitizeConnectorPreferences,
} from "./local-connector-protocol";

describe("previewAiPreferencesKey", () => {
  it("scopes Preview preferences to one member and organization", () => {
    const scope = "a".repeat(64);
    expect(previewAiPreferencesKey(scope)).toBe(
      `ciele.preview.ai-preferences.${scope}`
    );
    expect(() => previewAiPreferencesKey("shared")).toThrow(
      "Invalid preview preference scope"
    );
  });
});

describe("parseConnectorPairing", () => {
  const scope = "a".repeat(64);

  it("reads a connector pairing from a URL fragment", () => {
    expect(
      parseConnectorPairing(
        `#connectorPort=3217&connectorToken=abc123&connectorScope=${scope}`
      )
    ).toEqual({ port: 3217, token: "abc123", scope });
  });

  it.each([
    "",
    `#connectorPort=80&connectorToken=abc123&connectorScope=${scope}`,
    `#connectorPort=3217&connectorToken=short&connectorScope=${scope}`,
    `#connectorPort=nope&connectorToken=abc123&connectorScope=${scope}`,
    "#connectorPort=3217&connectorToken=abc123",
  ])("rejects invalid pairing data: %s", (fragment) => {
    expect(parseConnectorPairing(fragment)).toBeNull();
  });
});

describe("connectorBaseUrl", () => {
  it("always targets IPv4 loopback", () => {
    expect(connectorBaseUrl(3217)).toBe("http://127.0.0.1:3217");
  });
});

describe("connectorNeedsUpgrade", () => {
  it("requires the model/usage-capable connector without downgrading newer releases", () => {
    expect(connectorNeedsUpgrade("0.1.0")).toBe(true);
    expect(connectorNeedsUpgrade("0.2.0")).toBe(true);
    expect(connectorNeedsUpgrade("0.2.1")).toBe(true);
    expect(connectorNeedsUpgrade("0.3.0")).toBe(true);
    expect(connectorNeedsUpgrade("0.3.1")).toBe(true);
    expect(connectorNeedsUpgrade("0.3.2")).toBe(true);
    expect(connectorNeedsUpgrade("0.3.4")).toBe(false);
    expect(connectorNeedsUpgrade("unknown")).toBe(true);
  });
});

describe("sanitizeConnectorPreferences", () => {
  it("accepts a local subscription model selector", () => {
    expect(
      sanitizeConnectorPreferences({
        defaultModel: "local:openai:gpt-5.6-sol",
        followUpBehavior: "steer",
      })
    ).toEqual({
      defaultModel: "local:openai:gpt-5.6-sol",
      followUpBehavior: "steer",
    });
  });

  it("falls back safely for malformed stored preferences", () => {
    expect(
      sanitizeConnectorPreferences({
        defaultModel: "platform:openai:gpt-5.6-sol",
        followUpBehavior: "unknown",
      })
    ).toEqual(DEFAULT_CONNECTOR_PREFERENCES);
  });
});

describe("sanitizeConnectorStatus", () => {
  it("keeps real provider models and clamps usage percentages", () => {
    expect(
      sanitizeConnectorStatus({
        version: "0.2.1",
        relayConnected: true,
        providers: [
          {
            provider: "openai",
            label: "ChatGPT Subscription",
            available: true,
            connected: true,
            connecting: false,
            models: [
              {
                id: "gpt-5.6-sol",
                label: "GPT-5.6-Sol",
                inputModalities: ["text", "image", "audio"],
              },
            ],
            usage: {
              windows: [
                {
                  label: "Weekly",
                  usedPercent: 64,
                  remainingPercent: 36,
                  resetsAt: 1_800_000_000,
                },
                {
                  label: "Malformed",
                  usedPercent: 120,
                  remainingPercent: -20,
                },
              ],
            },
            tokenUsage: {
              inputTokens: 1_234,
              outputTokens: 321,
              updatedAt: 1_800_000_001,
            },
          },
        ],
        preferences: DEFAULT_CONNECTOR_PREFERENCES,
      })
    ).toMatchObject({
      version: "0.2.1",
      relayConnected: true,
      providers: [
        {
          provider: "openai",
          models: [
            {
              id: "gpt-5.6-sol",
              label: "GPT-5.6-Sol",
              inputModalities: ["text", "image"],
            },
          ],
          usage: {
            windows: [
              {
                label: "Weekly",
                usedPercent: 64,
                remainingPercent: 36,
                resetsAt: 1_800_000_000,
              },
              {
                label: "Malformed",
                usedPercent: 100,
                remainingPercent: 0,
              },
            ],
          },
          tokenUsage: {
            inputTokens: 1_234,
            outputTokens: 321,
            updatedAt: 1_800_000_001,
          },
        },
      ],
    });
  });
});
