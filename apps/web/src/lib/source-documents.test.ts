import { describe, expect, it } from "vitest";
import {
  assistantDocumentsHref,
  libraryDocumentsHref,
  parseSourceDocumentsParams,
  relativeTimeLabel,
  sourceDocumentHref,
  sourceDocumentsPageHref,
  sourceDocumentsQuery,
  sourceDocumentsParamsHref,
  sourceDocumentsSortHref,
  sourceDocumentTone,
  type SourceDocumentsSearchParams,
} from "./source-documents";

/** A params object; the two newer fields default to "no column, no filter". */
const at = (
  page: number,
  ascending: boolean,
  over: Partial<SourceDocumentsSearchParams> = {}
): SourceDocumentsSearchParams => ({
  page,
  ascending,
  sort: "",
  status: "",
  ...over,
});

describe("parseSourceDocumentsParams", () => {
  it("defaults to page one, newest first", () => {
    expect(parseSourceDocumentsParams({})).toEqual(at(1, false));
  });

  it("clamps garbage rather than failing the route", () => {
    expect(parseSourceDocumentsParams({ page: "0" }).page).toBe(1);
    expect(parseSourceDocumentsParams({ page: "-4" }).page).toBe(1);
    expect(parseSourceDocumentsParams({ page: "banana" }).page).toBe(1);
    expect(parseSourceDocumentsParams({ page: ["3", "9"] }).page).toBe(3);
  });

  it("reads the direction, the column and the Status filter", () => {
    expect(parseSourceDocumentsParams({ sort: "oldest" }).ascending).toBe(true);
    expect(parseSourceDocumentsParams({ sort: "sideways" }).ascending).toBe(false);
    expect(parseSourceDocumentsParams({ column: "title" }).sort).toBe("title");
    expect(parseSourceDocumentsParams({ column: "memories" }).sort).toBe("");
    expect(parseSourceDocumentsParams({ status: "excluded" }).status).toBe(
      "excluded"
    );
    // A hand-typed state the table cannot produce reads as no filter, not as
    // an empty page.
    expect(parseSourceDocumentsParams({ status: "melted" }).status).toBe("");
  });
});

describe("hrefs", () => {
  it("puts the Library tab in the path, so back returns to it", () => {
    expect(libraryDocumentsHref("website", "src-1")).toBe(
      "/library/websites/src-1"
    );
    expect(libraryDocumentsHref("faq", "src-2")).toBe("/library/faqs/src-2");
    expect(libraryDocumentsHref("file", "src-3")).toBe("/library/files/src-3");
  });

  it("has the same route under an Assistant", () => {
    expect(assistantDocumentsHref("a1", "src-1")).toBe(
      "/assistants/a1/knowledge/src-1"
    );
  });

  it("leaves the default page and sort out of the URL", () => {
    const base = "/library/websites/src-1";
    expect(sourceDocumentsPageHref(base, at(1, false), 1)).toBe(
      base
    );
    expect(sourceDocumentsPageHref(base, at(1, false), 3)).toBe(
      `${base}?page=3`
    );
    expect(sourceDocumentsPageHref(base, at(3, true), 2)).toBe(
      `${base}?page=2&sort=oldest`
    );
  });

  it("carries the table's page and sort into a Document row's link", () => {
    // So the Document route's breadcrumb returns to the same place (#928),
    // not to page one of the default order.
    const base = "/library/websites/src-1";
    expect(sourceDocumentHref(base, "doc-9", at(1, false))).toBe(
      `${base}/doc-9`
    );
    expect(sourceDocumentHref(base, "doc-9", at(3, true))).toBe(
      `${base}/doc-9?page=3&sort=oldest`
    );
    expect(sourceDocumentsQuery(at(1, false))).toBe("");
    expect(sourceDocumentsQuery(at(3, true))).toBe(
      "page=3&sort=oldest"
    );
  });

  it("carries the column and the filter in the query string", () => {
    expect(
      sourceDocumentsQuery(at(2, true, { sort: "title", status: "excluded" }))
    ).toBe("page=2&sort=oldest&column=title&status=excluded");
  });

  it("returns to page one when a header changes anything", () => {
    const base = "/library/websites/src-1";
    expect(
      sourceDocumentsParamsHref(base, at(4, false), { sort: "title" })
    ).toBe(`${base}?column=title`);
    expect(
      sourceDocumentsParamsHref(base, at(4, false, { sort: "title" }), {
        status: "excluded",
      })
    ).toBe(`${base}?column=title&status=excluded`);
  });

  it("returns to page one when the sort flips", () => {
    // Page 4 of the old order is a different set of rows in the new one.
    expect(
      sourceDocumentsSortHref("/library/websites/src-1", at(4, false))
    ).toBe("/library/websites/src-1?sort=oldest");
    expect(
      sourceDocumentsSortHref("/library/websites/src-1", at(4, true))
    ).toBe("/library/websites/src-1");
  });
});

describe("relativeTimeLabel", () => {
  const now = new Date("2026-09-20T12:00:00.000Z");
  const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();

  it("reads as a person would say it", () => {
    expect(relativeTimeLabel(ago(5_000), now)).toBe("just now");
    expect(relativeTimeLabel(ago(60_000), now)).toBe("1 minute ago");
    expect(relativeTimeLabel(ago(90 * 60_000), now)).toBe("1 hour ago");
    expect(relativeTimeLabel(ago(50 * 3_600_000), now)).toBe("2 days ago");
    expect(relativeTimeLabel(ago(60 * 86_400_000), now)).toBe("2 months ago");
    expect(relativeTimeLabel(ago(800 * 86_400_000), now)).toBe("2 years ago");
  });

  it("says nothing rather than NaN for a date it cannot read", () => {
    expect(relativeTimeLabel("not a date", now)).toBe("");
  });

  it("never goes negative when a row is a second ahead of the clock", () => {
    expect(relativeTimeLabel(ago(-5_000), now)).toBe("just now");
  });
});

describe("sourceDocumentTone", () => {
  it("colours the three states the badge shows", () => {
    expect(sourceDocumentTone("ready")).toBe("green");
    expect(sourceDocumentTone("pending")).toBe("amber");
    // Excluded is a choice an admin made, not a failure, so it is not a
    // warning colour sitting next to one.
    expect(sourceDocumentTone("excluded")).toBe("gray");
  });
});
