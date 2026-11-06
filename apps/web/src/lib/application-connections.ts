import {
  applicationConnectionOwnerType,
  type ApplicationConnection,
  type ApplicationProvider,
} from "@agent-hub/core";
import { can, type Access } from "./rbac";

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
  access: Access
): boolean {
  return applicationConnectionOwnerType(provider) === "member"
    ? can(access, "applications:edit")
    : can(access, "applications:connect");
}

/** Existing personal authorizations can only be refreshed by their owner. */
export function canReconnectApplicationConnection(
  connection: ApplicationConnection,
  memberId: string,
  access: Access
): boolean {
  if (!canAuthorizeApplicationProvider(connection.provider, access)) return false;
  if (applicationConnectionOwnerType(connection.provider) === "organization") {
    return true;
  }
  return connection.ownerType === "member"
    ? connection.ownerMemberId === memberId
    : can(access, "applications:connect") && connection.status === "reauthorization_required";
}

/** Admins may govern all rows; Members may remove only their own personal row. */
export function canDeleteApplicationConnection(
  connection: ApplicationConnection,
  memberId: string,
  access: Access
): boolean {
  return (
    can(access, "applications:connect") ||
    (can(access, "applications:edit") &&
      connection.ownerType === "member" &&
      connection.ownerMemberId === memberId)
  );
}
