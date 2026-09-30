import { afterEach, describe, expect, it } from "vitest";
import {
  cachedFindDetail,
  cachedFindPage,
  cachedFindRecords,
  expireFindCaches,
  type FindScope,
} from "./find-cache";
import type { FindPreviewData, FindRecordsResult } from "./find-index";

/**
 * How long the palette's server answers are reused, and for whom. The rules
 * that matter are the two that protect the reader: an answer is never served
 * to someone other than who it was read for, and a degraded answer is never
 * served to anyone after the one who asked.
 */

const owner: FindScope = { organizationId: "org-a", userId: "u-1", role: "owner" };
const records = (partial = false): FindRecordsResult => ({ records: [], partial });
const detail = (partial = false): FindPreviewData => ({
  summary: "x",
  stats: [],
  items: [],
  links: [],
  linksLabel: "",
  messages: [],
  ...(partial ? { partial: true as const } : {}),
});

/** A read that counts how often it ran. */
function counted<T>(value: T) {
  const read = () => {
    read.calls += 1;
    return Promise.resolve(value);
  };
  read.calls = 0;
  return read;
}

afterEach(() => {
  for (const org of ["org-a", "org-b"]) expireFindCaches(org);
});

describe("the Find cache", () => {
  it("reuses a complete answer for the same Member", async () => {
    const read = counted(records());
    await cachedFindRecords(owner, read);
    await cachedFindRecords(owner, read);
    expect(read.calls).toBe(1);
  });

  it("never keeps a partial answer, so the next caller reads again", async () => {
    const list = counted(records(true));
    await cachedFindRecords(owner, list);
    await cachedFindRecords(owner, list);
    expect(list.calls).toBe(2);

    const row = counted(detail(true));
    await cachedFindDetail(owner, "assistant", "a1", row);
    await cachedFindDetail(owner, "assistant", "a1", row);
    expect(row.calls).toBe(2);

    const page = counted(detail(true));
    await cachedFindPage(owner, "/inbox", page);
    await cachedFindPage(owner, "/inbox", page);
    expect(page.calls).toBe(2);
  });

  it("serves no Member another's answer, nor their own from before a role change", async () => {
    const read = counted(records());
    await cachedFindRecords(owner, read);
    await cachedFindRecords({ ...owner, userId: "u-2" }, read);
    await cachedFindRecords({ ...owner, role: "viewer" }, read);
    await cachedFindRecords({ ...owner, organizationId: "org-b" }, read);
    expect(read.calls).toBe(4);
  });

  it("keeps a record's detail and a page's numbers apart", async () => {
    const row = counted(detail());
    const page = counted(detail());
    await cachedFindDetail(owner, "assistant", "a1", row);
    await cachedFindPage(owner, "a1", page);
    expect([row.calls, page.calls]).toEqual([1, 1]);
  });

  it("forgets one Organization's answers on a mutation there, and only those", async () => {
    const a = counted(records());
    const b = counted(records());
    const other = { ...owner, organizationId: "org-b" };
    await cachedFindRecords(owner, a);
    await cachedFindRecords(other, b);
    const row = counted(detail());
    await cachedFindDetail(owner, "assistant", "a1", row);

    expireFindCaches("org-a");
    await cachedFindRecords(owner, a);
    await cachedFindRecords(other, b);
    await cachedFindDetail(owner, "assistant", "a1", row);
    expect([a.calls, b.calls, row.calls]).toEqual([2, 1, 2]);
  });
});
