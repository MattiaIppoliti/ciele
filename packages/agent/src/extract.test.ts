import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:dns/promises", () => ({ lookup: vi.fn() }));
vi.mock("./pinned-fetch", () => ({
  pinnedRequest: vi.fn(),
  fetchPinnedPage: vi.fn(),
}));

import { lookup } from "node:dns/promises";
import { pinnedRequest, type PinnedFetchResponse } from "./pinned-fetch";
import { extractSourceText, htmlToText } from "./extract";

describe("htmlToText", () => {
  it("strips scripts, styles and tags but keeps content text", async () => {
    const { text } = await htmlToText(
      `<html><head><style>p { color: red }</style></head>
       <body><script>var hidden = "secret";</script><p>Exam rules</p></body></html>`
    );
    expect(text).toBe("Exam rules");
    expect(text).not.toContain("secret");
    expect(text).not.toContain("color");
  });

  it("separates block elements so words never jam together", async () => {
    const { text } = await htmlToText("<body><p>Hello</p><p>World</p></body>");
    expect(text).toBe("Hello World");
  });

  it("decodes HTML entities", async () => {
    const { text } = await htmlToText("<body><p>Fees &amp; deadlines &mdash; 2026</p></body>");
    expect(text).toContain("Fees & deadlines");
  });

  it("extracts the page title", async () => {
    const { title } = await htmlToText(
      "<html><head><title>  Course \n Catalog </title></head><body>x</body></html>"
    );
    expect(title).toBe("Course Catalog");
  });

  it("tolerates malformed HTML and documents without <body>", async () => {
    const { text } = await htmlToText("<div><p>Unclosed paragraph<div>Next</div>");
    expect(text).toContain("Unclosed paragraph");
    expect(text).toContain("Next");
  });

  it("drops HTML comments", async () => {
    const { text } = await htmlToText("<body><!-- internal note -->Visible</body>");
    expect(text).toBe("Visible");
  });
});

describe("extractSourceText", () => {
  it("passes pasted text through with a default name", async () => {
    const result = await extractSourceText({ kind: "text", name: "  ", text: "hello" });
    expect(result).toEqual({ name: "Pasted text", text: "hello" });
  });

  it("keeps a provided text name, trimmed", async () => {
    const result = await extractSourceText({ kind: "text", name: " Notes ", text: "hello" });
    expect(result.name).toBe("Notes");
  });

  it("decodes plain-text file uploads", async () => {
    const bytes = new TextEncoder().encode("plain contents").buffer as ArrayBuffer;
    const result = await extractSourceText({ kind: "file", name: "notes.txt", bytes });
    expect(result).toEqual({ name: "notes.txt", text: "plain contents" });
  });

  it("rejects files that yield no text", async () => {
    const bytes = new TextEncoder().encode("   ").buffer as ArrayBuffer;
    await expect(
      extractSourceText({ kind: "file", name: "empty.txt", bytes })
    ).rejects.toThrow("No text could be extracted");
  });
});

describe("extractSourceText url (admin \"add URL\" source)", () => {
  const lookupMock = vi.mocked(lookup);
  const requestMock = vi.mocked(pinnedRequest);

  function pinnedResponse(status: number, text = ""): PinnedFetchResponse {
    return {
      status,
      ok: status >= 200 && status < 300,
      headers: new Headers({ "content-type": "text/html" }),
      text,
    };
  }

  beforeEach(() => {
    lookupMock.mockReset();
    lookupMock.mockResolvedValue([
      { address: "93.184.216.34", family: 4 },
    ] as never);
    requestMock.mockReset();
  });

  it("fetches through the egress guard and extracts title and text", async () => {
    requestMock.mockResolvedValueOnce(
      pinnedResponse(
        200,
        "<html><head><title>Fees</title></head><body><p>Tuition fees</p></body></html>"
      )
    );
    const result = await extractSourceText({
      kind: "url",
      url: "https://public.example/fees",
    });
    expect(result).toEqual({ name: "Fees", text: "Tuition fees" });
  });

  it("rejects a loopback URL before anything connects", async () => {
    await expect(
      extractSourceText({ kind: "url", url: "http://127.0.0.1/admin" })
    ).rejects.toThrow(/not allowed/i);
    expect(requestMock).not.toHaveBeenCalled();
  });

  it("rejects a hostname resolving to a private address", async () => {
    lookupMock.mockResolvedValueOnce([
      { address: "10.0.0.5", family: 4 },
    ] as never);
    await expect(
      extractSourceText({ kind: "url", url: "https://internal.example/wiki" })
    ).rejects.toThrow(/not allowed/i);
    expect(requestMock).not.toHaveBeenCalled();
  });

  it("reports HTTP failures by status", async () => {
    requestMock.mockResolvedValueOnce(pinnedResponse(503));
    await expect(
      extractSourceText({ kind: "url", url: "https://public.example/down" })
    ).rejects.toThrow("Fetch failed (503)");
  });
});
