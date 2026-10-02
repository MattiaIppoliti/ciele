/** Aggregate reporting available to the designated platform Organization. */
export interface PlatformInsightsRange {
  from: string;
  to: string;
}

export interface PlatformOrganizationInsights {
  id: string;
  name: string;
  members: number;
  assistants: number;
  conversations: number;
  sourceErrors: number;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  crawlPages: number;
  estimatedCostEur: number;
  platformCostEur: number;
}

export interface PlatformInsightsReport {
  range: PlatformInsightsRange;
  organizations: PlatformOrganizationInsights[];
  daily: Array<{ day: string; calls: number; estimatedCostEur: number }>;
}
