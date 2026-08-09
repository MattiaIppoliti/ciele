/**
 * What this deployment's /api/v1 speaks (#619). `API_V1_DOMAINS` grows one
 * entry per shipped domain slice — it is the capability list `GET /api/v1/meta`
 * advertises to clients deciding what they may call.
 */
export const API_V1_VERSION = 1;

export const API_V1_DOMAINS = [
  "assistants",
  "flows",
  "knowledge",
  "publish",
  "inbox",
  "improvements",
  "entities",
  "memories",
  "sso",
  "help-desks",
  "skills",
  "goals",
  "alerts",
  "organization",
  "members",
  "api-keys",
  "api-integrations",
  "providers",
] as const;
