import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  ATTACHMENT_MAX_CHARS,
  MAX_ATTACHMENTS_PER_MESSAGE,
} from "@agent-hub/core";
import {
  ATTACHMENT_ACCEPT,
  ATTACHMENT_MAX_BYTES,
  checkAttachment,
  isImageAttachment,
  openAttachment,
  openAttachments,
  sealAttachment,
} from "./attachments";

const priorKey = process.env.APP_ENCRYPTION_KEY;
beforeAll(() => {
  process.env.APP_ENCRYPTION_KEY = "attachment-test-key";
});
afterAll(() => {
  if (priorKey === undefined) delete process.env.APP_ENCRYPTION_KEY;
  else process.env.APP_ENCRYPTION_KEY = priorKey;
});

describe("checkAttachment", () => {
  it("accepts every extension the composer offers", () => {
    for (const accept of ATTACHMENT_ACCEPT.split(",")) {
      expect(
        checkAttachment({ name: `report${accept}`, size: 10 })
      ).toEqual({ ok: true });
    }
  });

  it("refuses a type nothing can read", () => {
    const result = checkAttachment({ name: "clip.mp4", size: 10 });
    expect(result.ok).toBe(false);
  });

  // The person holding a .doc is one Save As from a file that works, and the
  // generic refusal does not tell them that.
  it("names the modern format when refusing an old Office file", () => {
    for (const [old, modern] of [
      ["report.doc", "docx"],
      ["book.xls", "xlsx"],
      ["deck.ppt", "pptx"],
    ]) {
      const result = checkAttachment({ name: old, size: 10 });
      expect(result.ok).toBe(false);
      expect(result.ok === false && result.reason).toContain(`.${modern}`);
    }
  });

  it("accepts every type asked for: images, PDF, Word, Excel, PowerPoint, Markdown, text", () => {
    for (const name of [
      "a.png",
      "a.jpg",
      "a.pdf",
      "a.docx",
      "a.xlsx",
      "a.pptx",
      "a.md",
      "a.txt",
    ]) {
      expect(checkAttachment({ name, size: 10 })).toEqual({ ok: true });
    }
  });

  // An extension is a claim; this only checks the claim is one we serve.
  // `triageDocument` is what later decides the bytes agree with it.
  it("refuses an empty file and an oversized one", () => {
    expect(checkAttachment({ name: "a.pdf", size: 0 }).ok).toBe(false);
    expect(
      checkAttachment({ name: "a.pdf", size: ATTACHMENT_MAX_BYTES + 1 }).ok
    ).toBe(false);
    expect(
      checkAttachment({ name: "a.pdf", size: ATTACHMENT_MAX_BYTES }).ok
    ).toBe(true);
  });

  it("knows which names need an image reader", () => {
    expect(isImageAttachment("shot.PNG")).toBe(true);
    expect(isImageAttachment("shot.jpeg")).toBe(true);
    expect(isImageAttachment("report.pdf")).toBe(false);
  });
});

describe("sealing", () => {
  it("round-trips a name and its text", () => {
    const token = sealAttachment({ name: "notes.md", text: "hello there" });
    expect(openAttachment(token)).toEqual({
      name: "notes.md",
      text: "hello there",
    });
  });

  it("is opaque: the text is not readable in the token", () => {
    const token = sealAttachment({ name: "x.md", text: "SECRET-MARKER" });
    expect(token).not.toContain("SECRET-MARKER");
  });

  // The whole reason sealing is here: this text lands in the system prompt,
  // above the transcript. A client that could edit it could write the
  // Assistant's instructions.
  it("refuses a token whose ciphertext was edited", () => {
    const token = sealAttachment({ name: "x.md", text: "harmless" });
    const parts = token.split(".");
    const body = Buffer.from(parts[parts.length - 1], "base64");
    body[0] ^= 0xff;
    parts[parts.length - 1] = body.toString("base64");
    expect(openAttachment(parts.join("."))).toBeNull();
  });

  it("refuses a token this install did not seal", () => {
    expect(openAttachment("not-a-token")).toBeNull();
    expect(openAttachment("")).toBeNull();
    expect(openAttachment(null)).toBeNull();
    expect(openAttachment(42)).toBeNull();
  });

  it("refuses an expired token", () => {
    const token = sealAttachment({ name: "x.md", text: "stale" });
    vi.useFakeTimers();
    try {
      vi.setSystemTime(Date.now() + 2 * 60 * 60 * 1000);
      expect(openAttachment(token)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("caps the text it seals, on a line boundary", () => {
    const long = Array.from({ length: 2_000 }, (_, i) => `line ${i}`).join("\n");
    const opened = openAttachment(sealAttachment({ name: "x.md", text: long }));
    expect(opened!.text.length).toBeLessThanOrEqual(ATTACHMENT_MAX_CHARS);
    expect(opened!.text.endsWith("\n")).toBe(false);
  });
});

describe("openAttachments", () => {
  it("drops the bad ones and keeps the message", () => {
    const good = sealAttachment({ name: "a.md", text: "kept" });
    expect(openAttachments([good, "rubbish", null])).toEqual([
      { name: "a.md", text: "kept" },
    ]);
  });

  it("caps how many one message carries", () => {
    const tokens = Array.from({ length: 10 }, (_, i) =>
      sealAttachment({ name: `f${i}.md`, text: "x" })
    );
    expect(openAttachments(tokens)).toHaveLength(MAX_ATTACHMENTS_PER_MESSAGE);
  });

  it("answers empty for anything that is not a list", () => {
    expect(openAttachments("token")).toEqual([]);
    expect(openAttachments(undefined)).toEqual([]);
  });
});

