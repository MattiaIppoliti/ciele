import {
  applicationConnectionOwnerType,
  type ApplicationConnection,
  type ApplicationProvider,
  type Role,
} from "@agent-hub/core";
import { canEdit, canPublish } from "./rbac";

export type PublicApplicationConnection = Omit<
  ApplicationConnection,
  "sealedCredentials"
>;

/** Creates the only Application Connection shape that may cross into a Client Component. */
export function redactApplicationConnection(
  connection: ApplicationConnection
): PublicApplicationConnection {
  const safe = { ...connection };
  Reflect.deleteProperty(safe, "sealedCredentials");
  return safe;
}

/** Provider ownership is also the authorization boundary for starting OAuth. */
export function canAuthorizeApplicationProvider(
  provider: ApplicationProvider,
  role: Role | null
): boolean {
  return applicationConnectionOwnerType(provider) === "member"
    ? canEdit(role)
    : canPublish(role);
}

/** Existing personal authorizations can only be refreshed by their owner. */
export function canReconnectApplicationConnection(
  connection: ApplicationConnection,
  memberId: string,
  role: Role | null
): boolean {
  if (!canAuthorizeApplicationProvider(connection.provider, role)) return false;
  if (applicationConnectionOwnerType(connection.provider) === "organization") {
    return true;
  }
  return connection.ownerType === "member"
    ? connection.ownerMemberId === memberId
    : canPublish(role) && connection.status === "reauthorization_required";
}

/** Admins may govern all rows; Members may remove only their own personal row. */
export function canDeleteApplicationConnection(
  connection: ApplicationConnection,
  memberId: string,
  role: Role | null
): boolean {
  return (
    canPublish(role) ||
    (canEdit(role) &&
      connection.ownerType === "member" &&
      connection.ownerMemberId === memberId)
  );
}
