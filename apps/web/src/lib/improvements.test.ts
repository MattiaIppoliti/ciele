import { describe, expect, it } from "vitest";
import type {
  Improvement,
  ImprovementListItem,
  ImprovementStatus,
} from "@agent-hub/core";
import {
  emptyLaneRecord,
  keepsLinkNavigation,
  laneCountsWithOverrides,
  mergeImprovementRows,
  recordImprovementUpdate,
  retainPushedOffRows,
  type ImprovementLaneWindow,
  type ImprovementLaneWindows,
} from "./improvements";

const plain = {
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  button: 0,
};

describe("keepsLinkNavigation", () => {
  it("lets a plain left click open the drawer", () => {
    expect(keepsLinkNavigation(plain)).toBe(false);
  });

  it("keeps the navigation for middle click and every modifier", () => {
    expect(keepsLinkNavigation({ ...plain, button: 1 })).toBe(true);
    expect(keepsLinkNavigation({ ...plain, metaKey: true })).toBe(true);
    expect(keepsLinkNavigation({ ...plain, ctrlKey: true })).toBe(true);
    expect(keepsLinkNavigation({ ...plain, shiftKey: true })).toBe(true);
    expect(keepsLinkNavigation({ ...plain, altKey: true })).toBe(true);
  });
});

const item = (
  id: string,
  priority: ImprovementListItem["priority"],
  updatedAt: string,
): ImprovementListItem => ({
  id,
  organizationId: "org-1",
  seq: Number(id),
  title: `Item ${id}`,
  description: "",
  status: "to_do",
  priority,
  tags: [],
  assigneeId: null,
  dueDate: null,
  projectId: null,
  createdBy: null,
  createdAt: "2026-08-30T09:00:00.000Z",
  updatedAt,
  messageCount: 0,
});

const windows = (
  overrides: Partial<
    Record<ImprovementStatus, Partial<ImprovementLaneWindow>>
  > = {},
): ImprovementLaneWindows => {
  const all = emptyLaneRecord<ImprovementLaneWindow>(() => ({
    floor: Number.POSITIVE_INFINITY,
    exhausted: true,
  }));
  for (const [lane, window] of Object.entries(overrides)) {
    const status = lane as ImprovementStatus;
    all[status] = { ...all[status], ...window };
  }
  return all;
};

describe("mergeImprovementRows", () => {
  it("keeps the freshest copy of a row seen in several sources", () => {
    const staleDuplicate = item("2", "low", "2026-08-30T09:01:00.000Z");
    const refreshed = item("2", "medium", "2026-08-30T09:02:00.000Z");
    const loaded = item("1", "none", "2026-08-30T09:01:00.000Z");
    const updated = {
      ...loaded,
      priority: "high",
      updatedAt: "2026-08-30T09:03:00.000Z",
    } satisfies Improvement;

    expect(
      mergeImprovementRows(
        [[refreshed], [staleDuplicate, loaded]],
        { [loaded.id]: updated },
        windows(),
      ).rows.map(({ id, priority }) => ({ id, priority })),
    ).toEqual([
      { id: "2", priority: "medium" },
      { id: "1", priority: "high" },
    ]);
  });

  it("never lets an older mutation result overwrite a newer server row", () => {
    const row = item("5", "low", "2026-08-30T09:05:00.000Z");
    const older = {
      ...row,
      priority: "high",
      updatedAt: "2026-08-30T09:04:00.000Z",
    } satisfies Improvement;
    expect(
      mergeImprovementRows([[row]], { [row.id]: older }, windows()).rows[0]
        ?.priority,
    ).toBe("low");
  });

  const moved = {
    ...item("3", "low", "2026-08-30T09:10:00.000Z"),
    status: "done",
    messageCount: 4,
  } satisfies ImprovementListItem;
  const toDoPage = [item("9", "none", "2026-08-30T09:00:00.000Z")];
  const donePage = Array.from({ length: 50 }, (_, index) => ({
    ...item(String(100 + index), "none", "2026-08-30T09:00:00.000Z"),
    status: "done" as const,
  }));

  it("seeds a row moved onto a page nobody loaded, once", () => {
    // X sat on the first page of To do and was dropped into Done. The action
    // revalidated: the new To do page no longer has X, and Done's first page
    // is 50 rows all newer than X with more behind them, so X is on a Done
    // page nobody loaded. The confirmed result is the only copy left.
    const merged = mergeImprovementRows(
      [toDoPage, donePage],
      { [moved.id]: moved },
      windows({ done: { floor: 100, exhausted: false } }),
    );
    const seeded = merged.rows.filter((row) => row.id === moved.id);
    expect(seeded).toHaveLength(1);
    expect(seeded[0]).toMatchObject({ status: "done", messageCount: 4 });
    expect(merged.rows).toHaveLength(52);
    expect(merged.deleted).toEqual([]);
  });

  it("does not seed a row its whole target lane is loaded without", () => {
    // Same move, then the row was deleted (here or by a colleague). Done has
    // no further pages, so a row absent from it is gone, not unloaded.
    const merged = mergeImprovementRows(
      [toDoPage, donePage],
      { [moved.id]: moved },
      windows({ done: { floor: 100, exhausted: true } }),
    );
    expect(merged.rows.some((row) => row.id === moved.id)).toBe(false);
    expect(merged.deleted).toEqual([moved.id]);
  });

  it("does not seed a row whose seq falls inside the loaded range", () => {
    // Done has more pages, but the row's seq sits among the loaded ones: if
    // it existed the page would carry it.
    const inRange = { ...moved, seq: 125 };
    const merged = mergeImprovementRows(
      [toDoPage, donePage],
      { [inRange.id]: inRange },
      windows({ done: { floor: 100, exhausted: false } }),
    );
    expect(merged.rows.some((row) => row.id === inRange.id)).toBe(false);
    expect(merged.deleted).toEqual([inRange.id]);
  });
});

describe("recordImprovementUpdate", () => {
  const seen = {
    ...item("7", "none", "2026-08-30T09:00:00.000Z"),
    messageCount: 3,
  };
  const toDone = {
    ...item("7", "none", "2026-08-30T09:02:00.000Z"),
    status: "done",
  } satisfies Improvement;
  const toReview = {
    ...item("7", "none", "2026-08-30T09:01:00.000Z"),
    status: "in_review",
  } satisfies Improvement;

  it("keeps the newer result when two responses resolve out of order", () => {
    const first = recordImprovementUpdate({}, toDone, seen);
    const second = recordImprovementUpdate(first, toReview, seen);
    expect(second["7"]?.status).toBe("done");
    expect(second).toBe(first);
  });

  it("carries the message count the row was last seen with", () => {
    const recorded = recordImprovementUpdate({}, toDone, seen);
    expect(recorded["7"]?.messageCount).toBe(3);
    // A later update with no loaded copy left keeps the count already stored.
    const later = { ...toDone, updatedAt: "2026-08-30T09:03:00.000Z" };
    expect(
      recordImprovementUpdate(recorded, later, undefined)["7"]?.messageCount,
    ).toBe(3);
  });

  it("records nothing for a row the board has never seen", () => {
    expect(recordImprovementUpdate({}, toDone, undefined)).toEqual({});
  });
});

describe("retainPushedOffRows", () => {
  const page = (ids: string[], nextCursor: string | null) => ({
    items: ids.map((id) => item(id, "none", "2026-08-30T09:00:00.000Z")),
    nextCursor,
  });

  it("keeps the row a new arrival pushed onto the second page", () => {
    // First page held 9,8,7; a new row 10 arrived; the refreshed page is
    // 10,9,8 and row 7 is now on a page nobody has loaded.
    const previous = page(["9", "8", "7"], "7").items;
    const kept = retainPushedOffRows(previous, page(["10", "9", "8"], "8"), []);
    expect(kept.map((row) => row.id)).toEqual(["7"]);
  });

  it("does not keep what Load more already fetched", () => {
    const previous = page(["9", "8", "7"], "7").items;
    const additional = page(["7", "6"], "6").items;
    expect(
      retainPushedOffRows(previous, page(["10", "9", "8"], "8"), additional),
    ).toEqual([]);
  });

  it("keeps nothing when the lane fits in one page", () => {
    // Row 7 is gone from a page that has no further rows: it left the lane
    // (moved or deleted) rather than being pushed off.
    const previous = page(["9", "8", "7"], null).items;
    expect(retainPushedOffRows(previous, page(["9", "8"], null), [])).toEqual(
      [],
    );
  });

  it("does not resurrect a row the refreshed page still carries", () => {
    const previous = page(["9", "8", "7"], "7").items;
    expect(
      retainPushedOffRows(previous, page(["9", "8", "7"], "7"), []).map(
        (row) => row.id,
      ),
    ).toEqual([]);
  });
});

describe("laneCountsWithOverrides", () => {
  const server = { to_do: 3, in_progress: 1, in_review: 0, done: 0, archived: 0 };

  it("moves an optimistic card between lane counts", () => {
    const rows = [item("1", "none", "2026-08-30T09:00:00.000Z")];
    expect(laneCountsWithOverrides(server, rows, () => "done")).toEqual({
      ...server,
      to_do: 2,
      done: 1,
    });
  });

  it("leaves the server counts alone once the status is confirmed", () => {
    const rows = [
      { ...item("1", "none", "2026-08-30T09:00:00.000Z"), status: "done" as const },
    ];
    expect(laneCountsWithOverrides(server, rows, () => "done")).toEqual(server);
    expect(laneCountsWithOverrides(server, rows, (row) => row.status)).toEqual(
      server,
    );
  });
});
