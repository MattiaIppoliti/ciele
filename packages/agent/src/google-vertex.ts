import { createVertex } from "@ai-sdk/google-vertex";
import { getVercelOidcToken } from "@vercel/oidc";
import { ExternalAccountClient } from "google-auth-library";
import type { GoogleVertexFederatedConfig } from "@agent-hub/core";

function externalAccountAudience(audience: string): string {
  return audience.startsWith("https://iam.googleapis.com/")
    ? audience.slice("https:".length)
    : audience;
}

function oidcAudience(audience: string): string {
  return audience.startsWith("//iam.googleapis.com/")
    ? `https:${audience}`
    : audience;
}

export function createGoogleVertexProvider(config: GoogleVertexFederatedConfig) {
  const audience = externalAccountAudience(config.workloadIdentityAudience);
  const authClient = ExternalAccountClient.fromJSON({
    type: "external_account",
    audience,
    subject_token_type: "urn:ietf:params:oauth:token-type:jwt",
    token_url: "https://sts.googleapis.com/v1/token",
    ...(config.serviceAccountEmail
      ? {
          service_account_impersonation_url: `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${config.serviceAccountEmail}:generateAccessToken`,
        }
      : {}),
    subject_token_supplier: {
      getSubjectToken: () =>
        getVercelOidcToken({
          audience: oidcAudience(config.workloadIdentityAudience),
        }),
    },
  });
  if (!authClient) {
    throw new Error("Invalid Google Vertex federated credential config");
  }
  return createVertex({
    project: config.projectId,
    location: config.location,
    googleAuthOptions: {
      authClient,
      projectId: config.projectId,
    },
  });
}
