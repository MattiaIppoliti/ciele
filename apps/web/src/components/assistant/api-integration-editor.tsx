"use client";

import { useState, useTransition } from "react";
import {
  endpointPathParams,
  type ApiEndpointSpec,
  type ApiIntegrationAuthType,
} from "@agent-hub/core";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "@/lib/toast";
import {
  deleteApiIntegrationAction,
  setApiIntegrationAction,
  type ApiIntegrationView,
} from "@/app/actions";
import { Button, Hint, Input, Label } from "@agent-hub/ui";
import { AnimatedIcon } from "@/components/ui/animated-icon";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

/**
 * The API integration editor (spec #559): one base URL, one credential, and the
 * endpoint catalogue the assistant's model discovers, reads and queries through
 * three generic tools.
 *
 * The catalogue is not decoration — it is the allow-list. A path the model
 * produces is matched against these entries before any request goes out, so the
 * copy here says so: describing an endpoint is what makes it reachable, and
 * removing one is what makes it unreachable.
 *
 * The credential is write-only. It arrives sealed-at-rest and never comes back
 * to the browser; the field shows whether one is set, and saving without
 * touching it keeps it.
 */

const METHODS: ApiEndpointSpec["method"][] = [
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
];

const AUTH_LABELS: Record<ApiIntegrationAuthType, string> = {
  none: "None",
  bearer: "Bearer token",
  api_key: "API key header",
  basic: "Basic auth",
};

interface EndpointDraft {
  key: string;
  id: string;
  name: string;
  method: ApiEndpointSpec["method"];
  path: string;
  purpose: string;
  /** One per line: `name | path|query | type | description | required` */
  params: string;
  /** Comma-separated. */
  responseKeys: string;
}

let draftSeq = 0;
function newKey(): string {
  draftSeq += 1;
  return `draft-${draftSeq}`;
}

function draftFrom(endpoint: ApiEndpointSpec): EndpointDraft {
  const inPath = new Set(endpointPathParams(endpoint));
  return {
    key: newKey(),
    id: endpoint.id,
    name: endpoint.name,
    method: endpoint.method,
    path: endpoint.path,
    purpose: endpoint.purpose,
    params: (endpoint.params ?? [])
      .map((p) =>
        [
          p.name,
          p.in ?? (inPath.has(p.name) ? "path" : "query"),
          p.type ?? "string",
          p.description ?? "",
          p.required ? "required" : "",
        ]
          .join(" | ")
          .replace(/(\s\|\s*)+$/, "")
      )
      .join("\n"),
    responseKeys: (endpoint.responseKeys ?? []).join(", "),
  };
}

function emptyDraft(): EndpointDraft {
  return {
    key: newKey(),
    id: crypto.randomUUID(),
    name: "",
    method: "GET",
    path: "",
    purpose: "",
    params: "",
    responseKeys: "",
  };
}

function parseParams(text: string): ApiEndpointSpec["params"] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [name = "", where = "", type = "", description = "", flag = ""] = line
        .split("|")
        .map((part) => part.trim());
      return {
        name,
        in: where.toLowerCase() === "path" ? ("path" as const) : ("query" as const),
        type:
          type === "number" || type === "boolean"
            ? (type as "number" | "boolean")
            : ("string" as const),
        description: description || undefined,
        required: flag.toLowerCase() === "required",
      };
    })
    .filter((param) => param.name);
}

function toEndpoint(draft: EndpointDraft): ApiEndpointSpec {
  return {
    id: draft.id,
    name: draft.name.trim() || draft.path.trim(),
    method: draft.method,
    path: draft.path.trim().startsWith("/")
      ? draft.path.trim()
      : `/${draft.path.trim()}`,
    purpose: draft.purpose.trim(),
    params: parseParams(draft.params),
    responseKeys: draft.responseKeys
      .split(",")
      .map((key) => key.trim())
      .filter(Boolean),
  };
}

export function ApiIntegrationEditor({
  assistantId,
  integration,
  canEdit,
}: {
  assistantId: string;
  integration: ApiIntegrationView | null;
  canEdit: boolean;
}) {
  const [name, setName] = useState(integration?.name ?? "");
  const [baseUrl, setBaseUrl] = useState(integration?.baseUrl ?? "");
  const [authType, setAuthType] = useState<ApiIntegrationAuthType>(
    integration?.authType ?? "none"
  );
  const [authHeaderName, setAuthHeaderName] = useState(
    integration?.authHeaderName ?? ""
  );
  const [authUsername, setAuthUsername] = useState(
    integration?.authUsername ?? ""
  );
  /** null = leave the stored credential alone; a string = set (or clear) it. */
  const [credential, setCredential] = useState<string | null>(null);
  const [hasCredential, setHasCredential] = useState(
    integration?.hasCredential ?? false
  );
  const [endpoints, setEndpoints] = useState<EndpointDraft[]>(
    integration?.endpoints.map(draftFrom) ?? []
  );
  const [configured, setConfigured] = useState(integration !== null);
  const [pending, startTransition] = useTransition();

  function patchEndpoint(key: string, patch: Partial<EndpointDraft>) {
    setEndpoints((prev) =>
      prev.map((draft) => (draft.key === key ? { ...draft, ...patch } : draft))
    );
  }

  function save() {
    startTransition(async () => {
      const result = await setApiIntegrationAction(assistantId, {
        name,
        baseUrl,
        authType,
        authHeaderName,
        authUsername,
        ...(credential === null ? {} : { credential }),
        endpoints: endpoints.map(toEndpoint),
      });
      if (result.error) {
        toast.error(result.error);
        return;
      }
      if (credential !== null) setHasCredential(credential !== "");
      setCredential(null);
      setConfigured(true);
      toast.success("API integration saved");
    });
  }

  function remove() {
    startTransition(async () => {
      await deleteApiIntegrationAction(assistantId);
      setConfigured(false);
      setEndpoints([]);
      setHasCredential(false);
      setCredential(null);
      toast.success("API integration removed");
    });
  }

  return (
    <section>
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">API integration</h2>
          <p className="text-muted-foreground mt-1 text-sm">
            One API the assistant can query while answering. The model reads this
            catalogue, asks for the contract of the endpoints it needs, then calls
            them with the path values it learned in the conversation.{" "}
            <strong className="font-medium">
              Only a described endpoint can be reached
            </strong>{" "}
, a path this catalogue does not cover is refused before any request
            is made.
          </p>
        </div>
      </div>

      <div className="mt-4 space-y-4">
        <div className="flex gap-3">
          <div className="w-48 space-y-2">
            <Label htmlFor="api-name">Name</Label>
            <Input
              id="api-name"
              placeholder="Service desk API"
              value={name}
              disabled={!canEdit}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="flex-1 space-y-2">
            <Label htmlFor="api-base-url">Base URL (https)</Label>
            <Input
              id="api-base-url"
              placeholder="https://api.example.com/v1"
              value={baseUrl}
              disabled={!canEdit}
              onChange={(e) => setBaseUrl(e.target.value)}
            />
          </div>
        </div>

        <div className="flex flex-wrap gap-3">
          <div className="w-44 space-y-2">
            <Label>Authentication</Label>
            <Select
              value={authType}
              disabled={!canEdit}
              onValueChange={(value) =>
                setAuthType(value as ApiIntegrationAuthType)
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(AUTH_LABELS).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {authType === "api_key" && (
            <div className="w-44 space-y-2">
              <Label htmlFor="api-header">Header name</Label>
              <Input
                id="api-header"
                placeholder="x-api-key"
                value={authHeaderName}
                disabled={!canEdit}
                onChange={(e) => setAuthHeaderName(e.target.value)}
              />
            </div>
          )}
          {authType === "basic" && (
            <div className="w-44 space-y-2">
              <Label htmlFor="api-username">Username</Label>
              <Input
                id="api-username"
                value={authUsername}
                disabled={!canEdit}
                onChange={(e) => setAuthUsername(e.target.value)}
              />
            </div>
          )}
          {authType !== "none" && (
            <div className="min-w-56 flex-1 space-y-2">
              <Label htmlFor="api-credential">
                {authType === "basic" ? "Password" : "Token / key"}
              </Label>
              <Input
                id="api-credential"
                type="password"
                autoComplete="off"
                placeholder={
                  hasCredential
                    ? "•••••••• stored, type to replace"
                    : "Paste the credential"
                }
                value={credential ?? ""}
                disabled={!canEdit}
                onChange={(e) => setCredential(e.target.value)}
              />
              <p className="text-muted-foreground text-xs">
                Stored encrypted and never shown again. Leave blank to keep the
                one already stored.
              </p>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-4">
          <Label>Endpoint catalogue</Label>
          {canEdit && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setEndpoints((prev) => [...prev, emptyDraft()])}
            >
              <AnimatedIcon icon={Plus} size={16} /> Add endpoint
            </Button>
          )}
        </div>

        {endpoints.length === 0 && (
          <p className="text-muted-foreground rounded-lg border border-dashed px-4 py-6 text-center text-sm">
            No endpoints described yet, the assistant has no API to query.
          </p>
        )}

        {endpoints.map((draft) => (
          <div key={draft.key} className="space-y-3 rounded-lg border px-4 py-3">
            <div className="flex gap-3">
              <div className="w-28 space-y-2">
                <Label>Method</Label>
                <Select
                  value={draft.method}
                  disabled={!canEdit}
                  onValueChange={(method) =>
                    patchEndpoint(draft.key, {
                      method: method as ApiEndpointSpec["method"],
                    })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {METHODS.map((method) => (
                      <SelectItem key={method} value={method}>
                        {method}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex-1 space-y-2">
                <Label>Path, put path parameters in {"{braces}"}</Label>
                <Input
                  placeholder="/tickets/{ticketId}/comments"
                  value={draft.path}
                  disabled={!canEdit}
                  onChange={(e) =>
                    patchEndpoint(draft.key, { path: e.target.value })
                  }
                />
              </div>
              {canEdit && (
                <div className="flex items-end">
                  <Hint label="Remove endpoint">
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Remove endpoint"
                      onClick={() =>
                        setEndpoints((prev) =>
                          prev.filter((e) => e.key !== draft.key)
                        )
                      }
                    >
                      <AnimatedIcon icon={Trash2} size={16} />
                    </Button>
                  </Hint>
                </div>
              )}
            </div>
            <div className="flex gap-3">
              <div className="w-48 space-y-2">
                <Label>Name</Label>
                <Input
                  placeholder="Ticket comments"
                  value={draft.name}
                  disabled={!canEdit}
                  onChange={(e) =>
                    patchEndpoint(draft.key, { name: e.target.value })
                  }
                />
              </div>
              <div className="flex-1 space-y-2">
                <Label>Purpose, what it answers</Label>
                <Input
                  placeholder="The comments on one ticket"
                  value={draft.purpose}
                  disabled={!canEdit}
                  onChange={(e) =>
                    patchEndpoint(draft.key, { purpose: e.target.value })
                  }
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>
                Parameters, one per line: name | path or query | string, number
                or boolean | description | required
              </Label>
              <Textarea
                rows={2}
                placeholder={
                  "ticketId | path | string | The ticket identifier\nlimit | query | number | How many to return"
                }
                value={draft.params}
                disabled={!canEdit}
                onChange={(e) =>
                  patchEndpoint(draft.key, { params: e.target.value })
                }
              />
            </div>
            <div className="space-y-2">
              <Label>Response keys, comma separated</Label>
              <Input
                placeholder="items, total"
                value={draft.responseKeys}
                disabled={!canEdit}
                onChange={(e) =>
                  patchEndpoint(draft.key, { responseKeys: e.target.value })
                }
              />
            </div>
          </div>
        ))}

        {canEdit && (
          <div className="flex gap-2">
            <Button onClick={save} disabled={pending}>
              Save integration
            </Button>
            {configured && (
              <Button variant="outline" onClick={remove} disabled={pending}>
                Remove integration
              </Button>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
