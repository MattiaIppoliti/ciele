/**
 * Writes the synthetic Kestrel Freight corpus behind the stage-eval datasets:
 * one fictional organization spread over eight files in seven formats, so a
 * run measures reading a PDF, a Word file, a deck, a workbook, a CSV, a plain-text
 * standard, an Italian Markdown file and a change log that supersedes older values.
 *
 *   node packages/agent/scripts/stage-eval/build-corpus.mjs
 *
 * Every fact a question depends on is written here and nowhere else, and the
 * company does not exist, so a model can only answer from retrieval.
 * `verify-corpus.mts` then runs each file through the production extractor.
 */
import { Buffer } from "node:buffer";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { crc32, deflateRawSync } from "node:zlib";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, "corpus");
/**
 * The ZIP container the three OOXML files need, and nothing more: deflated
 * entries with a fixed 1980-01-01 timestamp, so a rebuild writes the same bytes.
 */
class OoxmlZip {
  entries = [];
  file(name, text) {
    this.entries.push({ name: Buffer.from(name), data: Buffer.from(text) });
  }
  async generateAsync() {
    const locals = [];
    const centrals = [];
    let offset = 0;
    for (const { name, data } of this.entries) {
      const packed = deflateRawSync(data);
      const crc = crc32(data);
      const header = (signature, extra) => {
        const b = Buffer.alloc(extra ? 46 : 30);
        b.writeUInt32LE(signature, 0);
        let at = 4;
        if (extra) b.writeUInt16LE(20, (at += 2) - 2); // version made by
        b.writeUInt16LE(20, at); // version needed
        b.writeUInt16LE(0, at + 2); // flags
        b.writeUInt16LE(8, at + 4); // deflate
        b.writeUInt16LE(0, at + 6); // time
        b.writeUInt16LE(33, at + 8); // date: 1980-01-01
        b.writeUInt32LE(crc, at + 10);
        b.writeUInt32LE(packed.length, at + 14);
        b.writeUInt32LE(data.length, at + 18);
        b.writeUInt16LE(name.length, at + 22);
        if (extra) b.writeUInt32LE(offset, 42); // local header offset
        return b;
      };
      const local = Buffer.concat([header(0x04034b50, false), name, packed]);
      centrals.push(Buffer.concat([header(0x02014b50, true), name]));
      locals.push(local);
      offset += local.length;
    }
    const directory = Buffer.concat(centrals);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(this.entries.length, 8);
    end.writeUInt16LE(this.entries.length, 10);
    end.writeUInt32LE(directory.length, 12);
    end.writeUInt32LE(offset, 16);
    return Buffer.concat([...locals, directory, end]);
  }
}
mkdirSync(OUT, { recursive: true });

const esc = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// ── PDF: a minimal text-only writer (Helvetica, WinAnsi, one text object per page) ──
function pdf(title, pages) {
  const winAnsi = (s) =>
    Buffer.from(
      s.replace(/[€]/g, "\x80").replace(/[–—]/g, "-").replace(/[’]/g, "'").replace(/[“”]/g, '"'),
      "latin1"
    ).toString("latin1");
  const escText = (s) => winAnsi(s).replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
  const wrap = (line, width = 92) => {
    if (line.length <= width) return [line];
    const words = line.split(" ");
    const out = [];
    let cur = "";
    for (const w of words) {
      if ((cur + " " + w).trim().length > width) {
        out.push(cur);
        cur = w;
      } else cur = (cur + " " + w).trim();
    }
    if (cur) out.push(cur);
    return out;
  };
  const objects = [];
  const add = (body) => {
    objects.push(body);
    return objects.length;
  };
  const catalog = add(null);
  const pagesObj = add(null);
  const font = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  const bold = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
  const kids = [];
  pages.forEach((page, index) => {
    const lines = [];
    let y = 800;
    const put = (text, f, size, gap) => {
      for (const l of wrap(text, f === "F2" ? 70 : 92)) {
        lines.push(`BT /${f} ${size} Tf 50 ${y} Td (${escText(l)}) Tj ET`);
        y -= gap;
      }
    };
    if (index === 0) put(title, "F2", 16, 26);
    for (const block of page) {
      if (block.startsWith("# ")) {
        y -= 6;
        put(block.slice(2), "F2", 12, 18);
      } else {
        put(block, "F1", 10, 14);
        y -= 4;
      }
    }
    put(`Page ${index + 1} of ${pages.length}`, "F1", 8, 10);
    const stream = lines.join("\n");
    const content = add(`<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`);
    kids.push(
      add(
        `<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${font} 0 R /F2 ${bold} 0 R >> >> /Contents ${content} 0 R >>`
      )
    );
  });
  objects[catalog - 1] = `<< /Type /Catalog /Pages ${pagesObj} 0 R >>`;
  objects[pagesObj - 1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(" ")}] /Count ${kids.length} >>`;
  let out = "%PDF-1.4\n%\xE2\xE3\xCF\xD3\n";
  const offsets = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(out, "latin1"));
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out, "latin1");
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) out += `${String(o).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

// ── DOCX ──
async function docx(paragraphs) {
  const zip = new OoxmlZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`
  );
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`
  );
  const body = paragraphs
    .map((p) => {
      if (Array.isArray(p)) {
        // a table: array of rows
        const rows = p
          .map((row) => `<w:tr>${row.map((c) => `<w:tc><w:p><w:r><w:t xml:space="preserve">${esc(c)}</w:t></w:r></w:p></w:tc>`).join("")}</w:tr>`)
          .join("");
        return `<w:tbl>${rows}</w:tbl>`;
      }
      const heading = p.startsWith("# ");
      const text = heading ? p.slice(2) : p;
      return `<w:p>${heading ? '<w:pPr><w:pStyle w:val="Heading1"/></w:pPr>' : ""}<w:r>${heading ? "<w:rPr><w:b/></w:rPr>" : ""}<w:t xml:space="preserve">${esc(text)}</w:t></w:r></w:p>`;
    })
    .join("");
  zip.file(
    "word/document.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`
  );
  return zip.generateAsync();
}

// ── XLSX (inline strings, several sheets) ──
async function xlsx(sheets) {
  const zip = new OoxmlZip();
  const overrides = sheets
    .map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`)
    .join("");
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${overrides}</Types>`
  );
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`
  );
  zip.file(
    "xl/workbook.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets
      .map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
      .join("")}</sheets></workbook>`
  );
  zip.file(
    "xl/_rels/workbook.xml.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets
      .map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`)
      .join("")}</Relationships>`
  );
  const col = (i) => String.fromCharCode(65 + i);
  sheets.forEach((sheet, si) => {
    const rows = sheet.rows
      .map(
        (row, r) =>
          `<row r="${r + 1}">${row
            .map((v, c) =>
              typeof v === "number"
                ? `<c r="${col(c)}${r + 1}"><v>${v}</v></c>`
                : `<c r="${col(c)}${r + 1}" t="inlineStr"><is><t>${esc(v)}</t></is></c>`
            )
            .join("")}</row>`
      )
      .join("");
    zip.file(
      `xl/worksheets/sheet${si + 1}.xml`,
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows}</sheetData></worksheet>`
    );
  });
  return zip.generateAsync();
}

// ── PPTX (one text box per slide) ──
async function pptx(slides) {
  const zip = new OoxmlZip();
  const ns = `xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"`;
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>${slides
      .map((_, i) => `<Override PartName="/ppt/slides/slide${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`)
      .join("")}</Types>`
  );
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/></Relationships>`
  );
  zip.file(
    "ppt/presentation.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:presentation ${ns}><p:sldIdLst>${slides
      .map((_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 1}"/>`)
      .join("")}</p:sldIdLst><p:sldSz cx="12192000" cy="6858000"/></p:presentation>`
  );
  zip.file(
    "ppt/_rels/presentation.xml.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${slides
      .map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${i + 1}.xml"/>`)
      .join("")}</Relationships>`
  );
  slides.forEach((lines, i) => {
    const paras = lines.map((l) => `<a:p><a:r><a:t>${esc(l)}</a:t></a:r></a:p>`).join("");
    zip.file(
      `ppt/slides/slide${i + 1}.xml`,
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sld ${ns}><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/><p:sp><p:nvSpPr><p:cNvPr id="2" name="Body"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/>${paras}</p:txBody></p:sp></p:spTree></p:cSld></p:sld>`
    );
  });
  return zip.generateAsync();
}

// ═════════════════════════════════════════════════════════════════════════════
// Content
// ═════════════════════════════════════════════════════════════════════════════

const handbook = pdf("Kestrel Freight Cooperative - Staff Handbook, version 4.2 (effective 1 March 2026)", [
  [
    "This handbook applies to every employee of Kestrel Freight Cooperative, in offices and in warehouses. Where a later entry in the Policy Change Log contradicts a value in this handbook, the change log prevails from its effective date.",
    "# 1. Annual leave",
    "Full-time employees receive 27 days of paid annual leave per calendar year, in addition to public holidays. Part-time employees receive leave pro rata to their contracted hours.",
    "Up to 6 unused days may be carried over into the next year. Carried-over days must be used by 31 March of that year, after which they lapse without compensation.",
    "Requests for a block of more than 5 consecutive working days must be submitted at least 14 calendar days in advance through the HR portal.",
    "# 2. Sick leave",
    "Employees may self-certify absence for up to 3 consecutive days. From the fourth day, a medical certificate is required and must reach HR within 2 working days.",
    "# 3. Parental leave",
    "Parents are entitled to 18 weeks of parental leave paid at 80% of base salary, which may be taken in up to three separate blocks before the child's third birthday.",
  ],
  [
    "# 4. Remote work",
    "Employees in office roles may work remotely up to 2 days per week, agreed with their line manager. Warehouse operatives and drivers are not eligible for remote work.",
    "Core hours for everyone working remotely are 10:00 to 15:30 Central European Time, during which the employee must be reachable.",
    "# 5. Expenses",
    "Expense claims must be submitted within 45 days of the expense. A receipt is required for every item above 25 EUR.",
    "The daily meal allowance for domestic business travel is capped at 38 EUR per day. International meals are covered by the per diem in Travel Policy TP-7.",
    "# 6. Probation and notice",
    "The probation period is 4 months. During probation, either party may end employment with 2 weeks of notice. After probation the notice period is 3 months, or 4 months for people managers.",
  ],
  [
    "# 7. Speaking up",
    "Concerns about fraud, safety or misconduct can be raised confidentially at ethics@kestrel.example. Reports are handled by the Compliance Officer, Ilse Varga, who acknowledges each report within 7 days.",
    "# 8. Company vehicles",
    "Company vans may only be driven by employees holding a category C1 licence for at least 2 years. Private use of company vehicles is not permitted.",
    "# 9. Training",
    "Every employee has an annual training budget of 1,150 EUR. Unused budget does not carry over. Forklift certification is renewed every 36 months and is paid by the company outside the personal budget.",
  ],
]);

const travel = await docx([
  "# Travel Policy TP-7, revision C",
  "Owner: Finance. Applies to all business travel booked on or after 1 January 2026.",
  "# 1. Approval",
  "A trip whose total estimated cost is below 1,200 EUR is approved by the traveller's line manager. A trip costing from 1,200 EUR up to and including 4,000 EUR requires the approval of the department head. Any trip above 4,000 EUR must be approved by the Chief Financial Officer, Marta Quiroga.",
  "# 2. Mode of transport",
  "Rail is the preferred mode for any journey that takes under 4 hours door to door. For flights, economy class applies to flights under 6 hours. Premium economy is allowed for flights of 6 to 9 hours. Business class is allowed for flights above 9 hours, or with a medical note approved by HR.",
  "Use of a private car is reimbursed at 0.39 EUR per kilometre. Tolls and parking are reimbursed at cost with a receipt.",
  "# 3. Per diem",
  "The per diem covers meals and incidental costs for each full travel day:",
  [
    ["Destination", "Per diem (EUR per day)"],
    ["Domestic (Italy)", "52"],
    ["European Union", "68"],
    ["Outside the European Union", "81"],
  ],
  "# 4. Hotel caps",
  "Hotel costs are reimbursed up to the following nightly caps, breakfast included:",
  [
    ["City", "Nightly cap"],
    ["Milan", "165 EUR"],
    ["Frankfurt", "180 EUR"],
    ["London", "210 GBP"],
    ["Any other city", "140 EUR"],
  ],
  "# 5. Booking",
  "All travel is booked through TravelDesk at least 10 working days before departure. A booking made later than that requires the justification code LB-2 and a one-line reason.",
]);

const changeLog = `KESTREL FREIGHT COOPERATIVE - POLICY CHANGE LOG
Entries are listed by effective date. An entry supersedes the document it names from its effective date.

2026-04-10  Staff Handbook 4.2, section 1: carry-over limit reviewed and left unchanged at 6 days.
2026-06-01  Staff Handbook 4.2, section 5: domestic daily meal cap raised from 38 EUR to 42 EUR.
2026-07-15  Staff Handbook 4.2, section 4: office roles based at the Lisbon hub may work remotely up to 3 days per week. All other locations remain at 2 days.
2026-09-01  Travel Policy TP-7 rev. C, section 3: European Union per diem raised from 68 EUR to 74 EUR. Domestic and non-EU rates unchanged.
2026-09-15  IT Security Standard: password rotation is no longer periodic; passwords are changed only after a suspected compromise.
`;

const warehouses = `code,city,country,manager,capacity_pallets,dock_doors,weekday_hours,saturday_hours,cold_storage
WH-01,Verona,IT,Paolo Benedetti,18400,22,06:00-22:00,07:00-13:00,yes
WH-02,Lyon,FR,Camille Dufresne,12750,16,06:00-20:00,closed,no
WH-03,Rotterdam,NL,Joost de Wit,31200,40,00:00-24:00,00:00-24:00,yes
WH-04,Poznan,PL,Agnieszka Wrobel,15900,18,05:00-21:00,06:00-14:00,no
WH-05,Zaragoza,ES,Lucia Ferrer,9800,12,07:00-19:00,closed,yes
WH-06,Lisbon,PT,Rui Carvalho,7300,9,07:00-19:00,08:00-12:00,no
`;

const opsReview = await pptx([
  ["Q3 2026 Operations Review", "Kestrel Freight Cooperative", "Prepared by the Operations Office, October 2026"],
  [
    "On-time delivery by warehouse, Q3 2026 (target: 95%)",
    "WH-01: 96.4%",
    "WH-02: 91.8%",
    "WH-03: 97.9%",
    "WH-04: 94.1%",
    "WH-05: 89.3%",
    "WH-06: 93.0%",
  ],
  [
    "Damaged shipments per 10,000, Q3 2026",
    "WH-01: 3.1",
    "WH-02: 4.7",
    "WH-03: 2.2",
    "WH-04: 3.9",
    "WH-05: 6.8",
    "WH-06: 2.9",
  ],
  [
    "Actions",
    "WH-05 improvement plan: owner is the site manager, deadline 15 December 2026.",
    "New automated sorter at WH-03: go-live 3 November 2026, capital cost 2.4 million EUR.",
    "WH-02 night shift pilot cancelled after the September review.",
  ],
  ["People", "Total headcount at 30 September 2026: 1,284 employees, of whom 212 are agency staff."],
]);

const rateCard = await xlsx([
  {
    name: "Rates",
    rows: [
      ["Base rate per parcel (EUR), valid 2026", "0-5 kg", "5-20 kg", "20-50 kg", "50-100 kg"],
      ["Zone A", 7.9, 11.4, 18.6, 29.5],
      ["Zone B", 12.3, 17.8, 27.9, 44.2],
      ["Zone C", 15.1, 22.6, 35.4, 57.8],
      ["Zone D", 19.7, 28.9, 46.3, 73.1],
    ],
  },
  {
    name: "Zones",
    rows: [
      ["Destination country", "Zone"],
      ["Italy", "A"],
      ["France", "B"],
      ["Germany", "B"],
      ["Netherlands", "B"],
      ["Belgium", "B"],
      ["Austria", "B"],
      ["Spain", "B"],
      ["Poland", "C"],
      ["Portugal", "C"],
      ["Greece", "C"],
      ["Romania", "C"],
      ["Czechia", "C"],
      ["United Kingdom", "D"],
      ["Switzerland", "D"],
      ["Norway", "D"],
    ],
  },
  {
    name: "Surcharges",
    rows: [
      ["Surcharge", "Amount", "Applies to"],
      ["Fuel", "8.5% of base rate", "every parcel"],
      ["Cold chain", "18% of base rate", "temperature-controlled parcels"],
      ["Remote area", "6.20 EUR flat", "islands and postcodes on the remote list"],
      ["Saturday delivery", "12.00 EUR flat", "on request"],
      ["Dangerous goods", "24.50 EUR flat", "ADR-classified contents"],
    ],
  },
]);

// Plain text rather than HTML: Knowledge uploads take text files, and an HTML
// page reaches Knowledge through a website Source, which this corpus has none of.
const security = `IT SECURITY STANDARD - KESTREL FREIGHT COOPERATIVE

This standard applies to every device and account issued by Kestrel Freight Cooperative.

SIGN-IN
Multi-factor authentication is mandatory for every account, using the approved authenticator app. Employees in Finance and all system administrators must use a hardware security key instead of the app.
Passwords must be at least 14 characters long. See the Policy Change Log for the current rotation rule.

REPORTING AN INCIDENT
Report a suspected incident within 1 hour to the security desk on internal extension 4477 or by email to soc@kestrel.example. A lost or stolen laptop is wiped remotely once reported.

REMOVABLE STORAGE
USB storage is blocked on company laptops. The only exception is the encrypted drive issued by IT, model Kestrel-Vault 64.

VISITORS AND WI-FI
Visitors use the KF-Guest network, whose password changes every Monday. Employees never connect personal devices to the KF-Corp network.
`;

const returns = `# Procedura resi - Kestrel Freight Cooperative

Questa procedura si applica ai resi dei clienti per spedizioni gestite da Kestrel Freight.

## Termini

- Il cliente può richiedere un reso entro 30 giorni dalla data di consegna.
- La merce danneggiata va segnalata entro 48 ore dalla consegna, allegando almeno due fotografie dell'imballo e del contenuto.
- Il rimborso viene emesso entro 14 giorni lavorativi dalla ricezione del reso in magazzino.

## Costi

Le spese di reso sono a carico del cliente, salvo il caso di merce difettosa o danneggiata durante il trasporto, per cui Kestrel Freight rimborsa anche le spese di spedizione.

## Autorizzazione

Ogni reso richiede un codice di autorizzazione nel formato RMA-AAAA-NNNNN, dove AAAA è l'anno e NNNNN un numero progressivo. Senza codice il magazzino rifiuta il collo.

## Eccezioni per zona

Per le destinazioni in zona D (Regno Unito, Svizzera, Norvegia) non è previsto il ritiro a domicilio: il cliente spedisce il reso tramite un corriere a sua scelta e a sue spese, anche in caso di difetto; la spedizione viene poi rimborsata su presentazione della ricevuta.
`;

const files = {
  "staff-handbook.pdf": handbook,
  "travel-policy-tp7.docx": travel,
  "policy-change-log.txt": changeLog,
  "warehouses.csv": warehouses,
  "q3-2026-operations-review.pptx": opsReview,
  "rate-card-2026.xlsx": rateCard,
  "it-security-standard.txt": security,
  "procedura-resi.md": returns,
};
for (const [name, bytes] of Object.entries(files)) {
  writeFileSync(path.join(OUT, name), bytes);
  process.stdout.write(`${name} ${bytes.length}\n`);
}
