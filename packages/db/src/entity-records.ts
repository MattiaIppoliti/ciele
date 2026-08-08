import type { EntityRecordValue } from "@agent-hub/core";

/** JSON-object equality for Entity Record values, independent of key order. */
export function entityRecordValuesEqual(
  left: Record<string, EntityRecordValue>,
  right: Record<string, EntityRecordValue>
): boolean {
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (key, index) => key === rightKeys[index] && left[key] === right[key]
    )
  );
}
