"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, ChevronsRight, Loader2 } from "lucide-react";
import { Badge, Button, Hint } from "@agent-hub/ui";
import { ResizeHandle, useResizableWidth } from "@/components/ui/resizable-panel";
import { CodeBlock } from "@/components/ui/code-block";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useShell } from "@/components/shell/shell-provider";
import {
  buildSnippet,
  capabilityRole,
} from "@/lib/developer-panel/snippets";
import {
  SNIPPET_TABS,
  SNIPPET_TAB_LABELS,
  type DeveloperPanelData,
  type PanelDomain,
  type PanelOperation,
  type SnippetTab,
} from "@/lib/developer-panel/types";
import type { ApiV1Domain } from "@/lib/api-v1/meta";

/**
 * The Developer Panel (#754): every way to drive the current page programmatically,
 * as copy-and-run snippets with the page's own ids already in them.
 *
 * Docked in the workspace's right rail rather than overlaid, so a snippet can be
 * read beside the setting it changes, which is also why it takes turns with the
 * live Preview instead of sitting next to it. The catalogue is fetched on open:
 * building it needs the /api/v1 contract registry, which imports the ops layer,
 * and none of that belongs in the client bundle.
 */

const PANEL_DEFAULT_WIDTH = 460;
const PANEL_MIN_WIDTH = 360;
const PANEL_MAX_WIDTH = 720;

/** The HTTP method as a quiet mono label, deliberately not a Badge: the two
 *  real badges beside it (Role, Idempotent) carry the information. */
function MethodLabel({ method }: { method: PanelOperation["method"] }) {
  return (
    <code className="text-muted-foreground shrink-0 font-mono text-[11px] tracking-wide uppercase">
      {method}
    </code>
  );
}

function capitalize(role: string): string {
  return role[0].toUpperCase() + role.slice(1);
}

function Operation({
  operation,
  domain,
  origin,
  variables,
  tab,
}: {
  operation: PanelOperation;
  domain: PanelDomain;
  origin: string;
  variables: Record<string, string>;
  tab: SnippetTab;
}) {
  const snippet = buildSnippet(tab, operation, domain, { origin, variables });
  const role = capabilityRole(operation.capability);
  const roleLabel = role ? capitalize(role) : null;
  // renderBodyShape elides anything past two levels as `{ … }`; the ellipsis
  // gets its promised pointer to the full contract.
  const bodyElided = tab === "curl" && operation.body?.includes("…");

  return (
    <section className="space-y-2">
      <header className="space-y-1">
        <div className="flex items-start justify-between gap-2">
          <h4 className="text-sm font-medium">{operation.summary}</h4>
          <div className="flex shrink-0 items-center gap-1">
            {roleLabel && (
              <Hint label={`An API key must carry the ${roleLabel} role or above`}>
                <Badge variant="secondary" className="text-[11px]">
                  {roleLabel}
                </Badge>
              </Hint>
            )}
            {operation.idempotent && (
              <Hint label="Safe to retry with an Idempotency-Key header">
                <Badge variant="outline" className="text-[11px]">
                  Idempotent
                </Badge>
              </Hint>
            )}
          </div>
        </div>
        <div className="text-muted-foreground flex items-center gap-2 font-mono text-[11px]">
          <MethodLabel method={operation.method} />
          <span className="truncate">/api/v1{operation.path}</span>
        </div>
      </header>
      {snippet.code ? (
        <CodeBlock code={snippet.code} language={snippet.language} />
      ) : (
        <p className="text-muted-foreground border-border/70 rounded-xl border border-dashed px-4 py-3 text-xs">
          {snippet.unavailable}
        </p>
      )}
      {bodyElided && (
        <p className="text-muted-foreground text-xs">
          Nested fields are elided as <code className="font-mono">…</code>. The
          full schema is at{" "}
          <a
            href={`${origin}/api/v1/openapi.json`}
            target="_blank"
            rel="noreferrer"
            className="text-foreground underline"
          >
            <code className="font-mono">/api/v1/openapi.json</code>
          </a>
          .
        </p>
      )}
    </section>
  );
}

function AuthBlock({
  auth,
  docsOrigin,
}: {
  auth: DeveloperPanelData["auth"];
  docsOrigin: string;
}) {
  // The key is stored as a hash, so the panel can never show an existing one.
  // The most it can do is name the variable and say where a key comes from.
  const command = `export CIELE_API_KEY=ciele_sk_…\nexport CIELE_BASE_URL=${auth.origin}`;
  // Derived from the same guard the API enforces, like the Role badges. A
  // hardcoded role name here would lie the day the rbac threshold moves.
  const managerRole = capabilityRole("manageApiKeys");

  return (
    <section className="space-y-2">
      <header className="flex items-baseline justify-between gap-2">
        <h4 className="text-sm font-medium">Authentication</h4>
        <a
          href={`${docsOrigin}/developers/api-keys`}
          target="_blank"
          rel="noreferrer"
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-0.5 text-xs"
        >
          API keys
          <ArrowUpRight className="size-3" />
        </a>
      </header>
      <CodeBlock code={command} language="bash" />
      {auth.demo ? (
        <p className="text-muted-foreground text-xs">
          This is the demo build with no Supabase configured, so no API key can
          exist here. The ids below are the demo data&apos;s own, so the commands
          are the real shape. They just have nothing to reach.
        </p>
      ) : auth.hasKeys === false ? (
        <p className="text-muted-foreground text-xs">
          This Organization has no API key yet. Nothing below will run until one
          exists.{" "}
          <Link href="/settings/api-keys" className="text-foreground underline">
            Create one in Settings
          </Link>
          . The secret is shown once, at creation.
        </p>
      ) : auth.hasKeys === null ? (
        <p className="text-muted-foreground text-xs">
          API keys are managed by {managerRole ? `${capitalize(managerRole)}s` : "Owners"}{" "}
          and above. Ask one of them for a key, or for the role to mint your own.
        </p>
      ) : (
        <p className="text-muted-foreground text-xs">
          Keys live in{" "}
          <Link href="/settings/api-keys" className="text-foreground underline">
            Settings → API Keys
          </Link>
          . The secret is shown once, at creation. A lost one is replaced, not
          recovered.
        </p>
      )}
    </section>
  );
}

function DomainSection({
  domain,
  origin,
  docsOrigin,
  variables,
  tab,
  showHeading,
}: {
  domain: PanelDomain;
  origin: string;
  docsOrigin: string;
  variables: Record<string, string>;
  tab: SnippetTab;
  showHeading: boolean;
}) {
  return (
    <div className="space-y-5">
      {showHeading && (
        <h3 className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
          {domain.title}
        </h3>
      )}
      {/* The prompt is how MCP is actually used; the per-operation tool calls
          below are for whoever is debugging their own client against ours. */}
      {tab === "mcp" && (
        <section className="space-y-2">
          <h4 className="text-sm font-medium">Ask an agent</h4>
          <CodeBlock code={domain.mcpPrompt} language="prompt" />
          <p className="text-muted-foreground text-xs">
            Everything below runs through the{" "}
            <code className="font-mono">{domain.mcpTool}</code> tool.
          </p>
        </section>
      )}
      {domain.operations.map((operation) => (
        <Operation
          key={operation.id}
          operation={operation}
          domain={domain}
          origin={origin}
          variables={variables}
          tab={tab}
        />
      ))}
      <a
        href={`${docsOrigin}${domain.docs[tab]}`}
        target="_blank"
        rel="noreferrer"
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-xs"
      >
        Full {SNIPPET_TAB_LABELS[tab]} reference
        <ArrowUpRight className="size-3" />
      </a>
    </div>
  );
}

export function DeveloperPanel({ domains }: { domains: ApiV1Domain[] }) {
  const { closeRightRail, snippetTab, setSnippetTab, snippetVariables } = useShell();
  const key = domains.join(",");
  // One value keyed by the request it answers, so switching domains shows the
  // loading state by derivation instead of a synchronous reset in the effect.
  const [fetched, setFetched] = useState<{
    key: string;
    data: DeveloperPanelData | null;
    failed: boolean;
  } | null>(null);
  const current = fetched?.key === key ? fetched : null;
  const data = current?.data ?? null;
  const failed = current?.failed ?? false;

  const { width, fade, resizing, beginResize, containerRef } = useResizableWidth({
    defaultWidth: PANEL_DEFAULT_WIDTH,
    minWidth: PANEL_MIN_WIDTH,
    maxWidth: PANEL_MAX_WIDTH,
  });

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/developer-panel?domains=${encodeURIComponent(key)}`, {
      signal: controller.signal,
    })
      .then((response) => (response.ok ? response.json() : Promise.reject(response)))
      .then((payload: DeveloperPanelData) =>
        setFetched({ key, data: payload, failed: false })
      )
      .catch(() => {
        if (!controller.signal.aborted) {
          setFetched({ key, data: null, failed: true });
        }
      });
    return () => controller.abort();
  }, [key]);

  return (
    <aside
      ref={containerRef}
      style={{ width }}
      className={`bg-background relative hidden shrink-0 flex-col border-l md:flex ${
        resizing ? "" : "transition-[width] duration-200 ease-out"
      }`}
    >
      <ResizeHandle
        resizing={resizing}
        onPointerDown={() => beginResize()}
        label="Resize developer panel"
      />
      <div
        className="flex min-h-0 flex-1 flex-col"
        style={{ width: Math.max(width, PANEL_MIN_WIDTH), opacity: fade }}
      >
        <header className="flex h-12 shrink-0 items-center justify-between gap-2 border-b px-3">
          <span className="truncate text-sm font-medium">
            {data && data.domains.length === 1 ? data.domains[0].title : "Developer"}
          </span>
          <Hint label="Hide developer panel" side="left">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Hide developer panel"
              onClick={() => closeRightRail("developer")}
            >
              <ChevronsRight className="size-4" />
            </Button>
          </Hint>
        </header>
        <Tabs
          value={snippetTab}
          onValueChange={(value) => {
            const next = SNIPPET_TABS.find((tab) => tab === value);
            if (next) setSnippetTab(next);
          }}
          className="shrink-0 gap-0 border-b px-3"
        >
          <TabsList variant="line">
            {SNIPPET_TABS.map((tab) => (
              <TabsTrigger key={tab} value={tab} className="text-xs">
                {SNIPPET_TAB_LABELS[tab]}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4">
          {failed ? (
            <p className="text-muted-foreground text-xs">
              The developer catalogue could not be loaded. The API reference at{" "}
              <code className="font-mono">/api/v1/openapi.json</code> is the same
              contract.
            </p>
          ) : !data ? (
            <div className="text-muted-foreground flex items-center gap-2 text-xs">
              <Loader2 className="size-3.5 animate-spin" />
              Loading the catalogue…
            </div>
          ) : (
            <div className="space-y-8">
              <AuthBlock auth={data.auth} docsOrigin={data.docsOrigin} />
              {data.domains.map((domain) => (
                <DomainSection
                  key={domain.domain}
                  domain={domain}
                  origin={data.auth.origin}
                  docsOrigin={data.docsOrigin}
                  variables={snippetVariables}
                  tab={snippetTab}
                  showHeading={data.domains.length > 1}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}
