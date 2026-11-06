import type { Organization, OrganizationPatch, RetentionDataType, RetentionUnit } from "@agent-hub/core";
import {
  DEFAULT_AUDIT_RETENTION_DAYS,
  isRetentionWindowValid,
  RETENTION_BOUNDS_MESSAGE,
  retentionPeriodDays,
  retentionPeriodFromDays,
} from "@agent-hub/core";

/**
 * The Data retention tab's form, as plain state (Settings > Data retention).
 *
 * One row per data type. A row is either on (an auto-delete window, stored in
 * days) or off (kept forever, stored as null). Audit records are always on.
 * Kept in TS rather than in the component so the rules, validation and which
 * change deletes data, are tested (vitest ignores `.tsx`).
 */

export interface RetentionRowState {
  enabled: boolean;
  /** The number field's raw text, so a half-typed value survives a render. */
  amount: string;
  unit: RetentionUnit;
}

export type RetentionFormState = Record<RetentionDataType, RetentionRowState>;

export interface RetentionRowSpec {
  type: RetentionDataType;
  title: string;
  description: string;
  /** Under the switch once it is on. */
  enabledHint: string;
  /** Audit records cannot be switched off. */
  alwaysOn: boolean;
  /** The Organization field this row reads and writes. */
  field: "transcriptRetentionDays" | "messageRetentionDays" | "improvementRetentionDays" | "auditRetentionDays";
  /** What the confirmation names when this window starts deleting. */
  noun: string;
}

export const RETENTION_ROWS: RetentionRowSpec[] = [
  {
    type: "conversations",
    title: "Conversations",
    description: "Chat threads between people and assistants, including their messages.",
    enabledHint: "Expired conversations are deleted with their messages.",
    alwaysOn: false,
    field: "transcriptRetentionDays",
    noun: "conversations",
  },
  {
    type: "messages",
    title: "Messages",
    description: "Individual prompts, answers and thinking steps inside a conversation.",
    enabledHint: "Expired messages are deleted from conversations that stay.",
    alwaysOn: false,
    field: "messageRetentionDays",
    noun: "messages",
  },
  {
    type: "improvements",
    title: "Improvements",
    description: "Deleted when not updated for the selected period, whatever their status.",
    enabledHint: "Improvements not updated in this period are deleted.",
    alwaysOn: false,
    field: "improvementRetentionDays",
    noun: "improvements",
  },
  {
    type: "audit",
    title: "Audit records",
    description: "Log of admin actions, like role changes, invitations and settings updates.",
    enabledHint: "Expired entries are deleted.",
    alwaysOn: true,
    field: "auditRetentionDays",
    noun: "audit records",
  },
];

/** What a switched-off row shows in its disabled fields: one year. */
const OFF_DISPLAY: Omit<RetentionRowState, "enabled"> = { amount: "1", unit: "years" };

function storedDays(organization: Organization, spec: RetentionRowSpec): number | null {
  if (spec.alwaysOn) return organization.auditRetentionDays ?? DEFAULT_AUDIT_RETENTION_DAYS;
  return organization[spec.field] ?? null;
}

export function initialRetentionState(organization: Organization): RetentionFormState {
  const state = {} as RetentionFormState;
  for (const spec of RETENTION_ROWS) {
    const days = storedDays(organization, spec);
    if (days === null) {
      state[spec.type] = { enabled: false, ...OFF_DISPLAY };
    } else {
      const period = retentionPeriodFromDays(days);
      state[spec.type] = { enabled: true, amount: String(period.amount), unit: period.unit };
    }
  }
  return state;
}

/** The window a row stands for: days, null when off, NaN when the field is not a number. */
export function rowDays(row: RetentionRowState): number | null {
  if (!row.enabled) return null;
  const amount = Number(row.amount);
  if (!Number.isInteger(amount) || amount < 1) return Number.NaN;
  return retentionPeriodDays({ amount, unit: row.unit });
}

export function rowError(row: RetentionRowState): string | null {
  const days = rowDays(row);
  if (days === null) return null;
  return isRetentionWindowValid(days) ? null : RETENTION_BOUNDS_MESSAGE;
}

export function isRowDirty(
  organization: Organization,
  spec: RetentionRowSpec,
  row: RetentionRowState
): boolean {
  const days = rowDays(row);
  return Number.isNaN(days) || days !== storedDays(organization, spec);
}

export interface RetentionSubmission {
  /** Only the windows that changed. */
  patch: OrganizationPatch;
  /**
   * The data types whose saved window deletes something it did not before: a
   * window switched on, or made shorter. These want a confirmation.
   */
  deletes: Array<{ noun: string; days: number }>;
}

/** Null while any row is invalid. */
export function retentionSubmission(
  organization: Organization,
  state: RetentionFormState
): RetentionSubmission | null {
  const patch: OrganizationPatch = {};
  const deletes: RetentionSubmission["deletes"] = [];
  for (const spec of RETENTION_ROWS) {
    const row = state[spec.type];
    if (rowError(row)) return null;
    const days = rowDays(row);
    const before = storedDays(organization, spec);
    if (days === before) continue;
    if (spec.alwaysOn) {
      if (days === null) return null;
      patch.auditRetentionDays = days;
    } else {
      patch[spec.field as Exclude<RetentionRowSpec["field"], "auditRetentionDays">] = days;
    }
    if (days !== null && (before === null || days < before)) {
      deletes.push({ noun: spec.noun, days });
    }
  }
  return { patch, deletes };
}

/** "1 year", "3 months", "45 days". */
export function describeDays(days: number): string {
  const { amount, unit } = retentionPeriodFromDays(days);
  const singular = unit.slice(0, -1);
  return `${amount} ${amount === 1 ? singular : unit}`;
}
