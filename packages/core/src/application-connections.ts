import type {
  ApplicationConnectionOwnerType,
  ApplicationProvider,
} from "./types";

const MEMBER_OWNED_PROVIDERS: ReadonlySet<ApplicationProvider> = new Set([
  "onedrive",
  "google_drive",
]);

/** The external account decides whether its authorization belongs to an Organization or Member. */
export function applicationConnectionOwnerType(
  provider: ApplicationProvider
): ApplicationConnectionOwnerType {
  return MEMBER_OWNED_PROVIDERS.has(provider) ? "member" : "organization";
}
