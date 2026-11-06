/**
 * Data retention, as pure derivations.
 *
 * An Organization sets one window per data type (Settings > Data retention).
 * Windows are stored in days; the console edits them as a number and a unit,
 * so the conversion lives here where both the form and its tests can reach it.
 * The bounds are the same ones the migration's check constraints enforce
 * (20261104130000_data_retention.sql).
 */

/** One month, the shortest window an auto-delete may use. */
export const RETENTION_MIN_DAYS = 30;
/** Five years, the longest. */
export const RETENTION_MAX_DAYS = 1825;
/** Audit records have no keep-forever setting. 180 days was the fixed window before it was configurable. */
export const DEFAULT_AUDIT_RETENTION_DAYS = 180;

export type RetentionUnit = "days" | "months" | "years";

const DAYS_PER_UNIT: Record<RetentionUnit, number> = {
  days: 1,
  months: 30,
  years: 365,
};

export interface RetentionPeriod {
  amount: number;
  unit: RetentionUnit;
}

/** A period in days. Months count 30 days and years 365, so the bounds are exact. */
export function retentionPeriodDays(period: RetentionPeriod): number {
  return period.amount * DAYS_PER_UNIT[period.unit];
}

/**
 * The largest unit a stored window divides into evenly, so 365 reads as
 * "1 year" and 400 as "400 days" rather than a fraction of anything.
 */
export function retentionPeriodFromDays(days: number): RetentionPeriod {
  if (days > 0 && days % DAYS_PER_UNIT.years === 0) {
    return { amount: days / DAYS_PER_UNIT.years, unit: "years" };
  }
  if (days > 0 && days % DAYS_PER_UNIT.months === 0) {
    return { amount: days / DAYS_PER_UNIT.months, unit: "months" };
  }
  return { amount: days, unit: "days" };
}

/** Whether a window in days is inside the allowed range. */
export function isRetentionWindowValid(days: number): boolean {
  return (
    Number.isInteger(days) && days >= RETENTION_MIN_DAYS && days <= RETENTION_MAX_DAYS
  );
}

export const RETENTION_BOUNDS_MESSAGE =
  "Auto-delete periods must be between 1 month and 5 years.";

/** The data types the Data retention tab lists, in order. */
export type RetentionDataType = "conversations" | "messages" | "improvements" | "audit";

