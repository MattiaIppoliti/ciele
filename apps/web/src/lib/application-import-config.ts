import type { ApplicationScopeOption } from "@agent-hub/agent";
import type { ApplicationProvider } from "@agent-hub/core";

function strings(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be selected`);
  const normalized = [
    ...new Set(
      value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean)
    ),
  ];
  if (normalized.some((item) => item.length > 300)) {
    throw new Error(`${label} contains an invalid identifier`);
  }
  return normalized;
}

export function normalizeApplicationImportConfig(
  provider: ApplicationProvider,
  config: Record<string, unknown>
): Record<string, unknown> {
  if (provider === "slack") {
    const channelIds = strings(config.channelIds, "At least one Slack channel");
    if (channelIds.length === 0) throw new Error("Select at least one Slack channel");
    if (channelIds.length > 20) throw new Error("Select at most 20 Slack channels");
    const allHistory = config.allHistory === true;
    const historyDays = allHistory ? 180 : Number(config.historyDays ?? 180);
    if (!Number.isInteger(historyDays) || historyDays < 1 || historyDays > 3650) {
      throw new Error("Slack history window is invalid");
    }
    return { channelIds, historyDays, allHistory };
  }
  if (provider === "servicenow") {
    const knowledgeBaseIds = strings(
      config.knowledgeBaseIds,
      "At least one knowledge base"
    );
    if (knowledgeBaseIds.length === 0) {
      throw new Error("Select at least one ServiceNow knowledge base");
    }
    if (knowledgeBaseIds.length > 20) {
      throw new Error("Select at most 20 ServiceNow knowledge bases");
    }
    return {
      knowledgeBaseIds,
      language:
        typeof config.language === "string" ? config.language.slice(0, 20) : "all",
    };
  }
  if (provider === "salesforce") {
    const language =
      typeof config.language === "string" && config.language.trim()
        ? config.language.trim().slice(0, 20)
        : "en_US";
    const dataCategories = strings(
      config.dataCategories ?? [],
      "Data categories"
    );
    const groups = dataCategories.map(
      (value) => value.replace(/^category:/, "").split(":")[0] ?? ""
    );
    if (dataCategories.length > 3 || new Set(groups).size !== groups.length) {
      throw new Error(
        "Select at most three Salesforce data categories from different groups"
      );
    }
    return {
      language,
      dataCategories,
      apiVersion:
        typeof config.apiVersion === "string" && /^v\d{2}\.\d$/.test(config.apiVersion)
          ? config.apiVersion
          : "v65.0",
    };
  }
  const scopeId =
    typeof config.scopeId === "string" ? config.scopeId.trim() : "";
  if (!scopeId) throw new Error("Select a drive or folder");
  const driveId =
    typeof config.driveId === "string" ? config.driveId.trim().slice(0, 300) : "";
  const folderId =
    typeof config.folderId === "string"
      ? config.folderId.trim().slice(0, 300)
      : "";
  return { scopeId, driveId, folderId };
}

/** Refuses guessed provider IDs and derives drive coordinates from discovery. */
export function validateApplicationImportScopes(
  provider: ApplicationProvider,
  config: Record<string, unknown>,
  scopes: ApplicationScopeOption[]
): Record<string, unknown> {
  const byId = new Map(scopes.map((scope) => [scope.id, scope]));
  const requireIds = (ids: string[], kinds: ApplicationScopeOption["kind"][]) => {
    if (ids.some((id) => !byId.has(id) || !kinds.includes(byId.get(id)!.kind))) {
      throw new Error("Selected Application scope is not available to this Connection");
    }
  };
  if (provider === "slack") {
    requireIds(config.channelIds as string[], ["channel"]);
  } else if (provider === "servicenow") {
    requireIds(config.knowledgeBaseIds as string[], ["knowledge_base"]);
  } else if (provider === "salesforce") {
    requireIds(config.dataCategories as string[], ["category"]);
    if (scopes.some((scope) => scope.kind === "language")) {
      requireIds([`language:${String(config.language)}`], ["language"]);
    }
  } else {
    const scope = byId.get(String(config.scopeId));
    if (!scope || !["drive", "folder"].includes(scope.kind)) {
      throw new Error("Selected Application scope is not available to this Connection");
    }
    return {
      ...config,
      driveId: String(scope.metadata.driveId ?? ""),
      folderId: String(scope.metadata.folderId ?? ""),
    };
  }
  return config;
}
