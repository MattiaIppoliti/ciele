import type {
  ApplicationConnection,
  ApplicationImport,
  ApplicationProvider,
} from "@agent-hub/core";

/** Provider-neutral content unit returned by every read-only Connector. */
export interface ApplicationArtifact {
  remoteId: string;
  title: string;
  text: string;
  canonicalUrl: string | null;
  revision: string | null;
  updatedAt: string | null;
  mimeType?: string | null;
  metadata: Record<string, unknown>;
}

export interface ApplicationConnectorResult {
  artifacts: ApplicationArtifact[];
  deletedRemoteIds?: string[];
  /** IDs observed without fetching unchanged content. */
  unchangedRemoteIds?: string[];
  /** Present only when this run enumerated the complete selected scope. */
  completeRemoteIds?: string[];
  skipped?: Array<{ remoteId: string | null; reason: string }>;
  failed?: Array<{ remoteId: string | null; reason: string }>;
  metrics?: { providerCalls: number; bytes: number };
  checkpoint: Record<string, unknown>;
  /** More provider pages remain; the durable job ledger schedules another claim. */
  continuationRequired?: boolean;
  /** Final page of a multi-claim full scan; unseen older mappings are tombstoned. */
  completeSnapshotStartedAt?: string;
  /** Rotated OAuth token bundle, sealed by the common sync service. */
  refreshedCredentials?: ApplicationCredentials;
}

export interface ApplicationCredentials {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: string;
  clientId?: string;
  clientSecret?: string;
  baseUrl?: string;
  instanceUrl?: string;
  tokenUrl?: string;
  tenantId?: string;
  teamId?: string;
  username?: string;
  password?: string;
}

export interface ApplicationScopeOption {
  id: string;
  label: string;
  kind: "language" | "category" | "knowledge_base" | "channel" | "drive" | "folder";
  parentId: string | null;
  metadata: Record<string, unknown>;
}

export interface ApplicationScopeDiscoveryResult {
  scopes: ApplicationScopeOption[];
  /** Rotated OAuth token bundle that the caller must seal and persist. */
  refreshedCredentials?: ApplicationCredentials;
}

/**
 * A Connector owns provider API pagination and normalization only. The common
 * sync service owns Sources, links, checkpoints, retries, and run reports.
 */
export interface ApplicationConnector {
  provider: ApplicationProvider;
  discoverScopes(input: {
    connection: ApplicationConnection;
    onCredentialsRefreshed?: (credentials: ApplicationCredentials) => Promise<void>;
  }): Promise<ApplicationScopeDiscoveryResult>;
  synchronize(input: {
    connection: ApplicationConnection;
    applicationImport: ApplicationImport;
    /** Stable timestamp shared by every claim of a complete snapshot. */
    syncStartedAt?: string;
    knownArtifacts: Record<
      string,
      { revision: string | null; contentHash: string }
    >;
    onCredentialsRefreshed?: (credentials: ApplicationCredentials) => Promise<void>;
    onProgress?: () => Promise<void>;
  }): Promise<ApplicationConnectorResult>;
}

export type ApplicationConnectorRegistry = Partial<
  Record<ApplicationProvider, ApplicationConnector>
>;
