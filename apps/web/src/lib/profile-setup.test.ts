import { describe, expect, it } from "vitest";
import type { Profile } from "@agent-hub/core";
import { profileSetup } from "./profile-setup";

const profile: Profile = {
  userId: "member-1",
  email: "member@example.com",
  firstName: "Lena",
  lastName: "Hartmann",
  username: "lena",
  avatarUrl: null,
};

describe("profile setup", () => {
  it("counts the signed-in email before a profile has been saved", () => {
    expect(profileSetup(null, profile.email, false)).toEqual({
      done: 1, total: 5, percent: 20, next: "Add your first name",
    });
  });

  it("asks for an uploaded photo even when an avatar can be generated", () => {
    expect(profileSetup(profile, profile.email, false)).toEqual({
      done: 4, total: 5, percent: 80, next: "Add a profile photo",
    });
  });

  it("returns complete when every field and a photo are saved", () => {
    expect(profileSetup({ ...profile, avatarUrl: "/photo.jpg" }, profile.email, false))
      .toEqual({ done: 5, total: 5, percent: 100, next: null });
  });

  it("does not count whitespace as a completed field", () => {
    expect(profileSetup({ ...profile, firstName: "  ", avatarUrl: " " }, profile.email, false))
      .toEqual({ done: 3, total: 5, percent: 60, next: "Add your first name" });
  });

  it("omits email in demo mode, where there is no authenticated account", () => {
    expect(profileSetup(profile, "demo", true)).toEqual({
      done: 3, total: 4, percent: 75, next: "Add a profile photo",
    });
  });
});
