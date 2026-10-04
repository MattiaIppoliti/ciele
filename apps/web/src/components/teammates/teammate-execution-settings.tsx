"use client";

import { useState } from "react";
import type { TeammateRuntimeConfig } from "@agent-hub/core";
import { Button, Label } from "@agent-hub/ui";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function TeammateExecutionSettings({
  teammateId,
  value,
  onChange,
  canGrant,
  options,
}: {
  teammateId: string;
  value: TeammateRuntimeConfig;
  onChange: (value: TeammateRuntimeConfig) => void;
  canGrant: boolean;
  options: {
    computerConfigured: boolean;
    harnesses: { id: string; name: string }[];
  };
}) {
  const [status, setStatus] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const selected =
    value.harness.kind === "ciele" ? "ciele" : value.harness.connectionId;
  const native = value.harness.kind === "ciele";
  const checkboxes = [
    {
      key: "internet",
      title: "Public internet",
      detail: "Read public pages and research current information.",
      checked: value.internet,
      available: true,
    },
    {
      key: "browser",
      title: "Browser",
      detail:
        "Browse in this teammate's persistent browser profile. Clicking and typing require edit permissions.",
      checked: value.computer.browser,
      available: options.computerConfigured && value.internet,
    },
    {
      key: "files",
      title: "Workspace files",
      detail:
        "Keep files in this teammate's isolated workspace across restarts. Writing requires edit permissions.",
      checked: value.computer.files,
      available: options.computerConfigured,
    },
    {
      key: "terminal",
      title: "Terminal",
      detail:
        "Run commands inside its computer. Requires internet, workspace files and edit permissions.",
      checked: value.computer.terminal,
      available:
        options.computerConfigured && value.internet && value.computer.files,
    },
  ];
  async function lifecycle(action: "status" | "start" | "stop") {
    setPending(true);
    try {
      const response = await fetch(
        `/api/teammates/${encodeURIComponent(teammateId)}/computer`,
        action === "status"
          ? {}
          : {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ action }),
            },
      );
      if (!response.ok) {
        setStatus(
          "Computer unavailable. Save permissions and check the computer service.",
        );
        return;
      }
      const result: unknown = await response.json();
      setStatus(
        result &&
          typeof result === "object" &&
          "state" in result &&
          typeof result.state === "string"
          ? result.state.replace(/_/g, " ")
          : "running",
      );
    } catch {
      setStatus("Computer service unavailable");
    } finally {
      setPending(false);
    }
  }
  function toggle(key: string, checked: boolean) {
    if (key === "internet") {
      onChange({
        ...value,
        internet: checked,
        computer: checked
          ? value.computer
          : { ...value.computer, browser: false, terminal: false },
      });
    } else if (key === "files") {
      onChange({
        ...value,
        computer: {
          ...value.computer,
          files: checked,
          terminal: checked && value.computer.terminal,
        },
      });
    } else if (key === "browser" || key === "terminal")
      onChange({ ...value, computer: { ...value.computer, [key]: checked } });
  }
  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <Label>Agent harness</Label>
        <Select
          value={selected}
          disabled={!canGrant}
          onValueChange={(id) =>
            onChange({
              ...value,
              harness:
                id === "ciele"
                  ? { kind: "ciele" }
                  : { kind: "ag_ui", connectionId: id },
            })
          }
        >
          <SelectTrigger aria-label="Agent harness">
            <SelectValue>
              {selected === "ciele"
                ? "Ciele"
                : (options.harnesses.find((harness) => harness.id === selected)
                    ?.name ?? "Unavailable harness")}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ciele">Ciele</SelectItem>
            {options.harnesses.map((harness) => (
              <SelectItem key={harness.id} value={harness.id}>
                {harness.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-muted-foreground text-sm">
          {native
            ? "Uses Ciele's models, knowledge and action permissions."
            : "Sends this conversation to the selected AG-UI harness. Its own tools and billing apply."}
        </p>
      </div>
      {native && (
        <div className="space-y-3">
          {checkboxes.map((item) => (
            <label key={item.key} className="flex items-start gap-3">
              <Checkbox
                checked={item.checked}
                disabled={!canGrant || !item.available}
                onCheckedChange={(checked) =>
                  toggle(item.key, checked === true)
                }
                className="mt-0.5"
              />
              <span>
                <span className="block text-sm font-medium">{item.title}</span>
                <span className="text-muted-foreground block text-sm">
                  {item.detail}
                </span>
              </span>
            </label>
          ))}
          {!options.computerConfigured && (
            <p className="text-muted-foreground text-sm">
              Connect the computer service on the server to enable browser,
              files and terminal.
            </p>
          )}
          {options.computerConfigured && (
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={pending}
                onClick={() => lifecycle("status")}
              >
                Check computer
              </Button>
              {canGrant && (
                <>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={pending}
                    onClick={() => lifecycle("start")}
                  >
                    Start
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={pending}
                    onClick={() => lifecycle("stop")}
                  >
                    Stop
                  </Button>
                </>
              )}
              {status && (
                <span role="status" className="text-muted-foreground text-sm">
                  {status}
                </span>
              )}
            </div>
          )}
        </div>
      )}
      {!canGrant && (
        <p className="text-muted-foreground text-sm">
          An organization admin can change execution permissions.
        </p>
      )}
    </div>
  );
}
