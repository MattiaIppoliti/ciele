import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:dns/promises", () => ({ lookup: vi.fn() }));
vi.mock("./pinned-fetch", () => ({
  pinnedRequest: vi.fn(),
}));
const pdfMocks = vi.hoisted(() => ({
  extractText: vi.fn(),
  getDocumentProxy: vi.fn(),
}));
vi.mock("unpdf", () => ({
  extractText: pdfMocks.extractText,
  getDocumentProxy: pdfMocks.getDocumentProxy,
}));

/** Real `%PDF-` bytes: triage reads the head before any parser is reached. */
const pdfBytes = (extra = 0) => {
  const head = new TextEncoder().encode("%PDF-1.7\n");
  const out = new Uint8Array(head.length + extra);
  out.set(head);
  return out.buffer as ArrayBuffer;
};

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
  beforeEach(() => {
    pdfMocks.extractText.mockReset();
    pdfMocks.getDocumentProxy.mockReset();
  });


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
    expect(result).toMatchObject({ name: "notes.txt", text: "plain contents" });
  });

  it("returns triage evidence over exactly the parsed bytes (#801, CYB-09)", async () => {
    const bytes = new TextEncoder().encode("plain contents").buffer as ArrayBuffer;
    const result = await extractSourceText({ kind: "file", name: "notes.txt", bytes });
    // sha256("plain contents"), computed independently of the implementation.
    const { createHash } = await import("node:crypto");
    expect(result.triage).toMatchObject({
      scanner: "document-triage",
      verdict: "clean",
      sha256: createHash("sha256").update("plain contents").digest("hex"),
    });
    expect(result.triage!.version).toBeGreaterThanOrEqual(2);
    // Non-file inputs carry no verdict: nothing was triaged.
    const text = await extractSourceText({ kind: "text", name: "n", text: "t" });
    expect(text.triage).toBeUndefined();
  });

  it("keeps PDF page boundaries for chunking and citations", async () => {
    pdfMocks.getDocumentProxy.mockResolvedValue({ numPages: 2 });
    pdfMocks.extractText.mockResolvedValue({
      totalPages: 2,
      text: ["First page", "Second page"],
    });

    const result = await extractSourceText({
      kind: "file",
      name: "handbook.pdf",
      bytes: pdfBytes(),
    });

    expect(pdfMocks.extractText).toHaveBeenCalledWith(
      { numPages: 2 },
      { mergePages: false }
    );
    expect(result.text).toBe("<!-- page:1 -->\nFirst page\n\n<!-- page:2 -->\nSecond page");
  });

  it("refuses a PDF with more pages than the parser budget (#801, CYB-09)", async () => {
    // Size does not bound this: a small file can declare tens of thousands of
    // pages, and each one is parser work plus an allocation.
    pdfMocks.getDocumentProxy.mockResolvedValue({ numPages: 5_000 });

    await expect(
      extractSourceText({ kind: "file", name: "huge.pdf", bytes: pdfBytes() })
    ).rejects.toThrow(/5000 pages; the limit is 2000/);
    expect(pdfMocks.extractText).not.toHaveBeenCalled();
  });

  it("refuses bytes that are not the format the name claims (#801, CYB-09)", async () => {
    const html = new TextEncoder().encode("<html>not a pdf</html>")
      .buffer as ArrayBuffer;

    await expect(
      extractSourceText({ kind: "file", name: "invoice.pdf", bytes: html })
    ).rejects.toThrow("not a PDF");
    expect(pdfMocks.getDocumentProxy).not.toHaveBeenCalled();
  });

  it("refuses an Office package whose contents cannot be read", async () => {
    // The wiring, not the rule: which packages are refused (macros, embedded
    // objects, a directory that will not parse) is asserted in
    // packages/core/src/document-triage.security.test.ts, where the archive
    // builder lives. What matters here is that triage runs at all, before
    // Mammoth is handed the bytes.
    const notReallyAZip = new Uint8Array([
      0x50, 0x4b, 0x03, 0x04,
      ...new TextEncoder().encode("word/document.xml"),
    ]);

    await expect(
      extractSourceText({
        kind: "file",
        name: "payroll.docx",
        bytes: notReallyAZip.buffer as ArrayBuffer,
      })
    ).rejects.toThrow(/could not be read as an Office document/);
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
