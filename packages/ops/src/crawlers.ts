import { sealSecret } from "@agent-hub/core";
import type { CrawlerConnection } from "@agent-hub/core";
import { z } from "zod";
import { defineOperation } from "./operation";

/**
 * Settings → Crawling: an Organization's own account on a remote crawler.
 * With one connected, that crawler's Website Source crawls run on the
 * Organization's token and bill its account instead of the platform's.
 */

/** What leaves the server: never the token, only its last four characters. */
export interface CrawlerConnectionView {
  provider: CrawlerConnection["provider"];
  tokenHint: string;
  accountId: string;
  updatedAt: string;
}

function crawlerView(connection: CrawlerConnection): CrawlerConnectionView {
  return {
    provider: connection.provider,
    tokenHint: connection.tokenHint,
    accountId: connection.accountId,
    updatedAt: connection.updatedAt,
  };
}

function hintOf(token: string): string {
  return token.length >= 4 ? `…${token.slice(-4)}` : "";
}

export const getCrawlerConnectionOp = defineOperation({
  name: "crawlers.get",
  capability: "manageMembers",
  input: z.object({ provider: z.enum(["apify"]) }),
  entities: () => [],
  run: async (ctx, { provider }): Promise<CrawlerConnectionView | null> => {
    const connection = await ctx.db.getCrawlerConnection(
      ctx.organizationId,
      provider
    );
    return connection ? crawlerView(connection) : null;
  },
});

export const setCrawlerConnectionOp = defineOperation({
  name: "crawlers.set",
  capability: "manageMembers",
  input: z.object({
    provider: z.enum(["apify"]),
    token: z.string().trim().min(1, "Paste the API token"),
    accountId: z.string().trim().max(200).optional(),
  }),
  entities: () => [{ kind: "crawlerSettings" as const }],
  run: async (
    ctx,
    input
  ): Promise<{ connection?: CrawlerConnectionView; error?: string }> => {
    let accountId = input.accountId ?? "";
    const verified = await ctx.ports?.verifyCrawlerToken?.(
      input.provider,
      input.token
    );
    if (verified && !verified.ok) return { error: verified.error };
    if (verified?.ok) {
      // The typed id is a cross-check, not a second source of truth: a token
      // from another account is almost always a paste from the wrong console.
      if (accountId && accountId !== verified.accountId) {
        return {
          error: `That token belongs to Apify account ${verified.accountId}, not ${accountId}.`,
        };
      }
      accountId = verified.accountId;
    }
    const connection = await ctx.db.setCrawlerConnection(ctx.organizationId, {
      provider: input.provider,
      encryptedToken: sealSecret(input.token),
      tokenHint: hintOf(input.token),
      accountId,
      createdBy: ctx.userId || null,
    });
    return { connection: crawlerView(connection) };
  },
});

export const deleteCrawlerConnectionOp = defineOperation({
  name: "crawlers.delete",
  capability: "manageMembers",
  input: z.object({ provider: z.enum(["apify"]) }),
  entities: () => [{ kind: "crawlerSettings" as const }],
  run: async (ctx, { provider }): Promise<void> => {
    await ctx.db.deleteCrawlerConnection(ctx.organizationId, provider);
  },
});
