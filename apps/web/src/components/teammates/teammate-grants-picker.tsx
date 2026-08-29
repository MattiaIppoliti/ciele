"use client";

import type {
  TeammateCapabilityCeiling,
  TeammateGrantDomain,
} from "@agent-hub/core";
import { Label } from "@agent-hub/ui";
import { ShieldAlert } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import {
  CEILING_COPY,
  GRANT_DOMAIN_COPY,
  bypassBlockedReason,
  grantSummary,
} from "@/lib/teammates/grant-copy";

export interface TeammateGovernanceState {
  domains: TeammateGrantDomain[];
  ceiling: TeammateCapabilityCeiling;
  approvalBypass: boolean;
}

/**
 * What this Teammate is allowed to do (#770).
 *
 * Rendered only for an admin, because granting is admin work: an Editor may
 * rename a colleague's Teammate and pick its knowledge, and must not be able to
 * arm it in the same dialog. A non-admin sees the summary sentence and no
 * controls, which is deliberate, what an agent in your workspace may do is not
 * a secret from the people working beside it.
 *
 * All copy comes from `lib/teammates/grant-copy.ts`, where it is tested; this
 * file is layout.
 */
export function TeammateGrantsPicker({
  value,
  onChange,
  canGrant,
}: {
  value: TeammateGovernanceState;
  onChange: (next: TeammateGovernanceState) => void;
  canGrant: boolean;
}) {
  const blocked = bypassBlockedReason(value.domains);

  function toggleDomain(domain: TeammateGrantDomain) {
    const held = value.domains.includes(domain);
    const domains = held
      ? value.domains.filter((d) => d !== domain)
      : [...value.domains, domain];
    onChange({
      domains,
      ceiling: value.ceiling,
      // Revoking a domain the bypass depends on takes the bypass with it, so
      // the stored state can never be a permission pointing at nothing.
      approvalBypass:
        value.approvalBypass && bypassBlockedReason(domains) === null,
    });
  }

  return (
    <div className="space-y-3">
      <div>
        <Label>What it can do</Label>
        <p className="text-muted-foreground mt-1 text-sm">
          {grantSummary(value.domains, value.ceiling, value.approvalBypass)}
        </p>
      </div>

      {canGrant && (
        <>
          <div className="space-y-2">
            {GRANT_DOMAIN_COPY.map((copy) => {
              const checked = value.domains.includes(copy.domain);
              return (
                <label
                  key={copy.domain}
                  className={`flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 transition-colors ${
                    checked
                      ? "border-primary ring-primary/30 ring-1"
                      : "hover:bg-muted/50"
                  }`}
                >
                  {/* The same Checkbox the Knowledge picker above it uses: two
                      lists of tick boxes in one dialog must not be two designs. */}
                  <Checkbox
                    className="mt-0.5"
                    checked={checked}
                    onCheckedChange={() => toggleDomain(copy.domain)}
                  />
                  <span className="space-y-0.5">
                    <span className="block text-sm font-medium">
                      {copy.label}
                    </span>
                    <span className="text-muted-foreground block text-xs">
                      {copy.detail}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>

          <div className="space-y-2">
            <Label>How far it can go</Label>
            <div className="flex gap-2">
              {CEILING_COPY.map((copy) => (
                <button
                  key={copy.ceiling}
                  type="button"
                  title={copy.detail}
                  onClick={() =>
                    onChange({ ...value, ceiling: copy.ceiling })
                  }
                  className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                    value.ceiling === copy.ceiling
                      ? "border-primary ring-primary/30 ring-1"
                      : "hover:bg-muted/50"
                  }`}
                >
                  {copy.label}
                </button>
              ))}
            </div>
          </div>

          <button
            type="button"
            disabled={blocked !== null}
            onClick={() =>
              onChange({ ...value, approvalBypass: !value.approvalBypass })
            }
            className={`flex w-full items-start gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors disabled:opacity-60 ${
              value.approvalBypass && !blocked
                ? "border-destructive/60 ring-destructive/30 ring-1"
                : "hover:bg-muted/50 disabled:hover:bg-transparent"
            }`}
          >
            <ShieldAlert className="text-muted-foreground mt-0.5 size-4 shrink-0" />
            <span className="space-y-0.5">
              <span className="block text-sm font-medium">
                Let it accept its own Suggested Fixes
              </span>
              <span className="text-muted-foreground block text-xs">
                {blocked ??
                  "Off by default. With this on, a fix it drafts becomes knowledge with nobody reviewing it."}
              </span>
            </span>
          </button>
        </>
      )}
    </div>
  );
}
