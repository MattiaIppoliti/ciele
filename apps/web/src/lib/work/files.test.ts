import { describe, expect, it } from "vitest";
import { fileKind, formatBytes, previewable, visibleFiles } from "./files";

const file = (name: string, contentType: string, sizeBytes: number, createdAt: string) => ({ name, contentType, sizeBytes, createdAt });

describe("files", () => {
  it("knows a file's family by its stored type", () => {
    expect(fileKind(file("a.png", "image/png", 1, ""))).toBe("image");
    expect(fileKind(file("a.pdf", "application/pdf", 1, ""))).toBe("pdf");
    expect(fileKind(file("a.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", 1, ""))).toBe("spreadsheet");
    expect(fileKind(file("a.pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation", 1, ""))).toBe("presentation");
    expect(fileKind(file("a.fig", "application/octet-stream", 1, ""))).toBe("other");
    expect(previewable(file("a.svg", "image/svg+xml", 1, ""))).toBe("image");
    expect(previewable(file("a.zip", "application/zip", 1, ""))).toBeNull();
  });

  it("reads sizes the way people say them", () => {
    expect(formatBytes(820)).toBe("820 B");
    expect(formatBytes(14 * 1024)).toBe("14 KB");
    expect(formatBytes(3.2 * 1024 * 1024)).toBe("3.2 MB");
    expect(formatBytes(1024 * 1024)).toBe("1 MB");
  });

  it("filters by family and text, then sorts", () => {
    const files = [
      file("Brief v2.pdf", "application/pdf", 300, "2026-10-02T00:00:00Z"),
      file("logo.png", "image/png", 900, "2026-10-03T00:00:00Z"),
      file("Brief v10.pdf", "application/pdf", 100, "2026-10-01T00:00:00Z"),
    ];
    expect(visibleFiles(files, { query: "", filter: "pdfs", sort: "name" }).map((f) => f.name)).toEqual(["Brief v2.pdf", "Brief v10.pdf"]);
    expect(visibleFiles(files, { query: "", filter: "all", sort: "size" }).map((f) => f.name)).toEqual(["logo.png", "Brief v2.pdf", "Brief v10.pdf"]);
    expect(visibleFiles(files, { query: "web-3", filter: "all", sort: "newest", taskText: (f) => (f.name === "logo.png" ? "WEB-3 Hero" : "") }).map((f) => f.name)).toEqual(["logo.png"]);
  });
});
