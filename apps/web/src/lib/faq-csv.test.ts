import { describe, expect, it } from "vitest";
import {
  FAQ_ANSWER_MAX,
  FAQ_IMPORT_MAX_ROWS,
  parseCsv,
  parseFaqCsv,
  serializeFaqCsv,
} from "./faq-csv";

describe("parseCsv", () => {
  it("parses plain records", () => {
    expect(parseCsv("a,b\nc,d")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  it("handles quoted fields with commas, newlines, and escaped quotes", () => {
    const text = '"What is a ""midterm""?","Line one,\nline two"\r\nq2,a2';
    expect(parseCsv(text)).toEqual([
      ['What is a "midterm"?', "Line one,\nline two"],
      ["q2", "a2"],
    ]);
  });

  it("tolerates CRLF and trailing newlines", () => {
    expect(parseCsv("a,b\r\nc,d\r\n\r\n")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });
});

describe("parseFaqCsv", () => {
  it("imports valid rows and skips the header", () => {
    const { rows, skipped } = parseFaqCsv(
      "question,answer\nWhat is a midterm?,An interim test.\nWhere are results?,In your personal area."
    );
    expect(rows).toEqual([
      { question: "What is a midterm?", answer: "An interim test." },
      { question: "Where are results?", answer: "In your personal area." },
    ]);
    expect(skipped).toEqual([]);
  });

  it("works without a header row", () => {
    const { rows } = parseFaqCsv("Q1,A1");
    expect(rows).toEqual([{ question: "Q1", answer: "A1" }]);
  });

  it("reports rows with the wrong column count instead of failing", () => {
    const { rows, skipped } = parseFaqCsv("Q1,A1\nonly-one-column\nQ2,A2");
    expect(rows.map((r) => r.question)).toEqual(["Q1", "Q2"]);
    expect(skipped).toEqual([
      "row 2: expected 2 columns (question, answer), got 1",
    ]);
  });

  it("rejects blank questions/answers and oversize answers", () => {
    const long = "x".repeat(FAQ_ANSWER_MAX + 1);
    const { rows, skipped } = parseFaqCsv(`Q1,${long}\n ,A2`);
    expect(rows).toEqual([]);
    expect(skipped).toHaveLength(2);
    expect(skipped[0]).toContain("exceeds");
    expect(skipped[1]).toContain("required");
  });

  it("caps the number of imported rows", () => {
    const text = Array.from({ length: FAQ_IMPORT_MAX_ROWS + 2 }, (_, i) => `Q${i},A${i}`).join("\n");
    const { rows, skipped } = parseFaqCsv(text);
    expect(rows).toHaveLength(FAQ_IMPORT_MAX_ROWS);
    expect(skipped).toHaveLength(2);
  });
});

describe("serializeFaqCsv", () => {
  it("round-trips through parseFaqCsv", () => {
    const rows = [
      { question: 'What is a "midterm"?', answer: "Line one,\nline two" },
      { question: "Q2", answer: "A2" },
    ];
    const { rows: reparsed, skipped } = parseFaqCsv(serializeFaqCsv(rows));
    expect(reparsed).toEqual(rows);
    expect(skipped).toEqual([]);
  });
});
