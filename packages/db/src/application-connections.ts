import {
  applicationConnectionOwnerType,
  type ApplicationConnectionOwnerType,
  type ApplicationProvider,
} from "@agent-hub/core";

export function resolveApplicationConnectionOwner(
  provider: ApplicationProvider,
  ownerMemberId: string | null | undefined
): {
  ownerType: ApplicationConnectionOwnerType;
  ownerMemberId: string | null;
} {
  const ownerType = applicationConnectionOwnerType(provider);
  const memberId = ownerMemberId?.trim() || null;
  if (ownerType === "member" && !memberId) {
    throw new Error(`${provider} requires the authorizing Member`);
  }
  if (ownerType === "organization" && memberId) {
    throw new Error(`${provider} is Organization-owned`);
  }
  return { ownerType, ownerMemberId: memberId };
}
