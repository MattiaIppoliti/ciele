import { describe, expect, it } from "vitest";
import { deflateRawSync } from "node:zlib";
import { ooxmlText } from "./ooxml";

/**
 * A minimal ZIP writer, so the tests read archives this code did not also
 * build a reader for. Both compression methods an OOXML package uses are
 * covered: stored, and deflate.
 */
function zip(
  files: Array<{ name: string; body: string }>,
  { deflate = true } = {}
): Uint8Array {
  const encoder = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;

  for (const file of files) {
    const name = encoder.encode(file.name);
    const raw = encoder.encode(file.body);
    const data = deflate ? new Uint8Array(deflateRawSync(raw)) : raw;
    const method = deflate ? 8 : 0;

    const local = new Uint8Array(30 + name.length + data.length);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(8, method, true);
    localView.setUint32(18, data.length, true);
    localView.setUint32(22, raw.length, true);
    localView.setUint16(26, name.length, true);
    local.set(name, 30);
    local.set(data, 30 + name.length);
    locals.push(local);

    const central = new Uint8Array(46 + name.length);
    const centralView = new DataView(central.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(10, method, true);
    centralView.setUint32(20, data.length, true);
    centralView.setUint32(24, raw.length, true);
    centralView.setUint16(28, name.length, true);
    centralView.setUint32(42, offset, true);
    central.set(name, 46);
    centrals.push(central);

    offset += local.length;
  }

  const centralSize = centrals.reduce((sum, c) => sum + c.length, 0);
  const eocd = new Uint8Array(22);
  const eocdView = new DataView(eocd.buffer);
  eocdView.setUint32(0, 0x06054b50, true);
  eocdView.setUint16(8, files.length, true);
  eocdView.setUint16(10, files.length, true);
  eocdView.setUint32(12, centralSize, true);
  eocdView.setUint32(16, offset, true);

  const total = offset + centralSize + eocd.length;
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of [...locals, ...centrals, eocd]) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

const WORKBOOK = `<?xml version="1.0"?>
<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="Q3 actuals" sheetId="1" r:id="rId7"/>
    <sheet name="Notes" sheetId="2" r:id="rId4"/>
  </sheets>
</workbook>`;

// Deliberately out of order: rId7 points at sheet2.xml. Pairing document order
// with the filenames would label both sheets wrongly, and silently.
const RELS = `<?xml version="1.0"?>
<Relationships>
  <Relationship Id="rId4" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId7" Target="worksheets/sheet2.xml"/>
</Relationships>`;

const SHARED = `<?xml version="1.0"?>
<sst><si><t>Region</t></si><si><t>Revenue</t></si><si><t>North</t></si></sst>`;

const SHEET2 = `<?xml version="1.0"?>
<worksheet><sheetData>
  <row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>
  <row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2"><v>4200</v></c></row>
  <row r="3"/>
</sheetData></worksheet>`;

const SHEET1 = `<?xml version="1.0"?>
<worksheet><sheetData>
  <row r="1"><c r="A1" t="inlineStr"><is><t>Checked by Ada</t></is></c></row>
</sheetData></worksheet>`;

function workbook(options?: { deflate?: boolean }) {
  return zip(
    [
      { name: "xl/workbook.xml", body: WORKBOOK },
      { name: "xl/_rels/workbook.xml.rels", body: RELS },
      { name: "xl/sharedStrings.xml", body: SHARED },
      { name: "xl/worksheets/sheet1.xml", body: SHEET1 },
      { name: "xl/worksheets/sheet2.xml", body: SHEET2 },
    ],
    options
  );
}

describe("ooxmlText, spreadsheets", () => {
  it("reads rows, resolving shared strings and inline strings", async () => {
    const text = await ooxmlText(workbook(), "xlsx");
    expect(text).toContain("Region\tRevenue");
    expect(text).toContain("North\t4200");
    expect(text).toContain("Checked by Ada");
  });

  it("names each sheet through the relationship map, not the filename", async () => {
    const text = await ooxmlText(workbook(), "xlsx");
    // rId7 → sheet2.xml, which holds the revenue grid.
    expect(text).toMatch(/## Q3 actuals\nRegion\tRevenue/);
    expect(text).toMatch(/## Notes\nChecked by Ada/);
  });

  it("reads stored entries as well as deflated ones", async () => {
    const text = await ooxmlText(workbook({ deflate: false }), "xlsx");
    expect(text).toContain("North\t4200");
  });

  it("drops a row that carries only formatting", async () => {
    const text = await ooxmlText(workbook(), "xlsx");
    expect(text.split("\n").filter((line) => line === "")).not.toHaveLength(0);
    expect(text).not.toMatch(/\n\t*\n\t*\n/);
  });

  it("falls back to worksheet parts when the relationship map is missing", async () => {
    const bytes = zip([
      { name: "xl/sharedStrings.xml", body: SHARED },
      { name: "xl/worksheets/sheet1.xml", body: SHEET1 },
    ]);
    const text = await ooxmlText(bytes, "xlsx");
    expect(text).toContain("Checked by Ada");
    expect(text).toContain("## Sheet 1");
  });

  it("answers empty rather than throwing on bytes that are not an archive", async () => {
    await expect(
      ooxmlText(new TextEncoder().encode("not a zip at all"), "xlsx")
    ).resolves.toBe("");
  });
});

const SLIDE_ONE = `<?xml version="1.0"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
  <p:cSld><p:spTree>
    <p:sp><p:txBody><a:p><a:r><a:t>Quarterly review</a:t></a:r></a:p></p:txBody></p:sp>
    <p:sp><p:txBody><a:p><a:r><a:t>Revenue up 12%</a:t></a:r></a:p></p:txBody></p:sp>
  </p:spTree></p:cSld>
</p:sld>`;

const SLIDE_TWO = `<?xml version="1.0"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
  <p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>Next steps</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld>
</p:sld>`;

describe("ooxmlText, decks", () => {
  it("reads every slide's text, in slide order", async () => {
    // Written to the archive out of order, and numbered past 9 so a plain
    // string sort would put slide10 before slide2.
    const bytes = zip([
      { name: "ppt/slides/slide10.xml", body: SLIDE_TWO },
      { name: "ppt/slides/slide2.xml", body: SLIDE_ONE },
    ]);
    const text = await ooxmlText(bytes, "pptx");
    expect(text.indexOf("Quarterly review")).toBeLessThan(
      text.indexOf("Next steps")
    );
    expect(text).toContain("Revenue up 12%");
    expect(text).toContain("## Slide 1");
  });

  it("skips a slide with no text rather than emitting an empty block", async () => {
    const bytes = zip([
      { name: "ppt/slides/slide1.xml", body: SLIDE_ONE },
      {
        name: "ppt/slides/slide2.xml",
        body: `<?xml version="1.0"?><p:sld xmlns:a="x"><p:cSld/></p:sld>`,
      },
    ]);
    const text = await ooxmlText(bytes, "pptx");
    expect(text).toContain("Quarterly review");
    expect(text).not.toContain("## Slide 2");
  });

  it("ignores parts that are not slides", async () => {
    const bytes = zip([
      { name: "ppt/slides/slide1.xml", body: SLIDE_ONE },
      { name: "ppt/notesSlides/notesSlide1.xml", body: SLIDE_TWO },
    ]);
    const text = await ooxmlText(bytes, "pptx");
    expect(text).not.toContain("Next steps");
  });
});
