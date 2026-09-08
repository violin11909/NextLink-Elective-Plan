/**
 * A very small .xlsx writer: enough for "download this table", and nothing else.
 *
 * An .xlsx file is a zip of XML parts, and the subset Excel needs for a plain
 * sheet of values is short enough to write out by hand — which is why there is
 * no library here. The alternatives were a ~400 kB dependency in a project
 * whose entire dependency list is Next and React, or handing people a CSV that
 * loses the header row, the column widths and (in Excel's Thai default
 * encoding) every Thai character in the file.
 *
 * What it does: inline strings, numbers, a bold frozen header, column widths,
 * an autofilter, and several sheets. What it deliberately does not do: shared
 * strings, formulas, merged cells, dates as date cells, or compression —
 * entries are stored, which costs a few kB on a file this size and removes the
 * need for a deflate implementation.
 *
 * Nothing here touches the DOM or the `@/` alias, so `node
 * --experimental-strip-types` can run it directly — see scripts/check-xlsx.mjs.
 */

/** `null` writes an empty cell; a number writes a numeric cell. */
export type CellValue = string | number | null;

/** `width` is in Excel's character units, roughly one digit of Calibri 11. */
export type SheetColumn = { header: string; width: number; wrap?: boolean };

export type Sheet = {
  name: string;
  columns: SheetColumn[];
  rows: CellValue[][];
  /** Freeze the header row and switch on Excel's filter dropdowns. */
  filter?: boolean;
};

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    table[index] = value >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let index = 0; index < bytes.length; index += 1) {
    crc = CRC_TABLE[(crc ^ bytes[index]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * XML-escape, and drop the control characters XML 1.0 has no way to carry.
 *
 * Escaping one as `&#1;` is not a rescue: the character is illegal in the
 * document either way, and Excel answers an illegal character by refusing to
 * open the file at all rather than by naming it. Dropping them costs a
 * stray glyph nobody typed on purpose.
 */
function xmlText(value: string): string {
  let out = "";
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (character === "&") out += "&amp;";
    else if (character === "<") out += "&lt;";
    else if (character === ">") out += "&gt;";
    else if (character === '"') out += "&quot;";
    else if (code < 0x20 && character !== "\t" && character !== "\n" && character !== "\r") continue;
    else out += character;
  }
  return out;
}

/** 0 → "A", 25 → "Z", 26 → "AA". */
export function columnName(index: number): string {
  let name = "";
  let remaining = index + 1;
  while (remaining > 0) {
    const rest = (remaining - 1) % 26;
    name = String.fromCharCode(65 + rest) + name;
    remaining = Math.floor((remaining - 1) / 26);
  }
  return name;
}

/**
 * Excel rejects a workbook whose sheet name carries `\ / ? * [ ] :` or runs
 * past 31 characters, and it rejects it by reporting the whole file as
 * corrupt. A term label is user-facing text, so it is cleaned rather than
 * trusted.
 */
function sheetName(raw: string, index: number): string {
  const cleaned = raw.replace(/[\\/?*[\]:]/g, " ").replace(/\s+/g, " ").trim().slice(0, 31);
  return cleaned || `Sheet${index + 1}`;
}

const XML_HEADER = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

/** Style ids used below: 0 plain, 1 header, 2 wrapped body text. */
const STYLE_BODY = 0;
const STYLE_HEADER = 1;
const STYLE_WRAP = 2;

function cellXml(reference: string, value: CellValue, style: number): string {
  const styleAttribute = style === STYLE_BODY ? "" : ` s="${style}"`;
  if (value === null || value === "") return `<c r="${reference}"${styleAttribute}/>`;
  if (typeof value === "number") {
    // A non-finite number has no XML representation Excel understands, so it
    // degrades to text rather than to a file that will not open.
    if (Number.isFinite(value)) return `<c r="${reference}"${styleAttribute}><v>${value}</v></c>`;
    return `<c r="${reference}"${styleAttribute} t="inlineStr"><is><t>${xmlText(String(value))}</t></is></c>`;
  }
  return `<c r="${reference}"${styleAttribute} t="inlineStr"><is><t xml:space="preserve">${xmlText(value)}</t></is></c>`;
}

function sheetXml(sheet: Sheet): string {
  const lastColumn = columnName(Math.max(sheet.columns.length - 1, 0));
  const lastRow = sheet.rows.length + 1;

  const frozen = sheet.filter
    ? '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'
    : '<sheetViews><sheetView workbookViewId="0"/></sheetViews>';

  const cols = sheet.columns
    .map((column, index) => `<col min="${index + 1}" max="${index + 1}" width="${column.width}" customWidth="1"/>`)
    .join("");

  const header = sheet.columns
    .map((column, index) => cellXml(`${columnName(index)}1`, column.header, STYLE_HEADER))
    .join("");

  const body = sheet.rows
    .map((row, rowIndex) => {
      const cells = sheet.columns
        .map((column, index) =>
          cellXml(`${columnName(index)}${rowIndex + 2}`, row[index] ?? null, column.wrap ? STYLE_WRAP : STYLE_BODY),
        )
        .join("");
      return `<row r="${rowIndex + 2}">${cells}</row>`;
    })
    .join("");

  // `autoFilter` belongs after `sheetData` in the schema's sequence; put it
  // before and Excel calls the file corrupt.
  const autoFilter = sheet.filter ? `<autoFilter ref="A1:${lastColumn}${lastRow}"/>` : "";

  return [
    XML_HEADER,
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">',
    `<dimension ref="A1:${lastColumn}${Math.max(lastRow, 1)}"/>`,
    frozen,
    '<sheetFormatPr defaultRowHeight="15"/>',
    cols ? `<cols>${cols}</cols>` : "",
    `<sheetData><row r="1">${header}</row>${body}</sheetData>`,
    autoFilter,
    "</worksheet>",
  ].join("");
}

/** Tahoma because it carries Thai glyphs on every Office install we target. */
const STYLES_XML = [
  XML_HEADER,
  '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">',
  '<fonts count="2">',
  '<font><sz val="11"/><name val="Tahoma"/></font>',
  '<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Tahoma"/></font>',
  "</fonts>",
  '<fills count="3">',
  '<fill><patternFill patternType="none"/></fill>',
  '<fill><patternFill patternType="gray125"/></fill>',
  '<fill><patternFill patternType="solid"><fgColor rgb="FF1E3150"/><bgColor indexed="64"/></patternFill></fill>',
  "</fills>",
  '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>',
  '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>',
  '<cellXfs count="3">',
  '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>',
  '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center"/></xf>',
  '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>',
  "</cellXfs>",
  '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>',
  "</styleSheet>",
].join("");

function workbookXml(names: string[]): string {
  const sheets = names
    .map((name, index) => `<sheet name="${xmlText(name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`)
    .join("");
  return [
    XML_HEADER,
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"',
    ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">',
    `<sheets>${sheets}</sheets>`,
    "</workbook>",
  ].join("");
}

function workbookRelsXml(count: number): string {
  const sheets = Array.from(
    { length: count },
    (_, index) =>
      `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`,
  ).join("");
  return [
    XML_HEADER,
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
    sheets,
    `<Relationship Id="rId${count + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`,
    "</Relationships>",
  ].join("");
}

function contentTypesXml(count: number): string {
  const sheets = Array.from(
    { length: count },
    (_, index) =>
      `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
  ).join("");
  return [
    XML_HEADER,
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
    '<Default Extension="xml" ContentType="application/xml"/>',
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>',
    sheets,
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>',
    "</Types>",
  ].join("");
}

const ROOT_RELS_XML = [
  XML_HEADER,
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>',
  "</Relationships>",
].join("");

type ZipEntry = { name: string; data: Uint8Array };

/** Stored (uncompressed) zip. See the header comment for why deflate is out. */
function zip(entries: ZipEntry[], modified: Date): Uint8Array<ArrayBuffer> {
  const encoder = new TextEncoder();
  const time =
    ((modified.getHours() << 11) | (modified.getMinutes() << 5) | Math.floor(modified.getSeconds() / 2)) & 0xffff;
  const date =
    (((Math.max(modified.getFullYear(), 1980) - 1980) << 9) | ((modified.getMonth() + 1) << 5) | modified.getDate()) &
    0xffff;

  const parts: Uint8Array[] = [];
  const directory: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const crc = crc32(entry.data);

    const local = new Uint8Array(30 + name.length);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(6, 0x0800, true); // entry names are UTF-8
    localView.setUint16(8, 0, true); // stored
    localView.setUint16(10, time, true);
    localView.setUint16(12, date, true);
    localView.setUint32(14, crc, true);
    localView.setUint32(18, entry.data.length, true);
    localView.setUint32(22, entry.data.length, true);
    localView.setUint16(26, name.length, true);
    local.set(name, 30);
    parts.push(local, entry.data);

    const central = new Uint8Array(46 + name.length);
    const centralView = new DataView(central.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint16(8, 0x0800, true);
    centralView.setUint16(10, 0, true);
    centralView.setUint16(12, time, true);
    centralView.setUint16(14, date, true);
    centralView.setUint32(16, crc, true);
    centralView.setUint32(20, entry.data.length, true);
    centralView.setUint32(24, entry.data.length, true);
    centralView.setUint16(28, name.length, true);
    centralView.setUint32(42, offset, true);
    central.set(name, 46);
    directory.push(central);

    offset += local.length + entry.data.length;
  }

  const directorySize = directory.reduce((total, part) => total + part.length, 0);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, entries.length, true);
  endView.setUint16(10, entries.length, true);
  endView.setUint32(12, directorySize, true);
  endView.setUint32(16, offset, true);

  const all = [...parts, ...directory, end];
  const size = all.reduce((total, part) => total + part.length, 0);
  const file = new Uint8Array(size);
  let at = 0;
  for (const part of all) {
    file.set(part, at);
    at += part.length;
  }
  return file;
}

/**
 * Build a workbook. `modified` exists so a test can ask for the same bytes
 * twice; in the app it defaults to now.
 *
 * The return type names the backing buffer because `Blob` refuses an array
 * that might be sharing a `SharedArrayBuffer`; this one never is.
 */
export function buildXlsx(sheets: Sheet[], options: { modified?: Date } = {}): Uint8Array<ArrayBuffer> {
  if (sheets.length === 0) throw new Error("buildXlsx: a workbook needs at least one sheet");
  const encoder = new TextEncoder();
  const names = sheets.map((sheet, index) => sheetName(sheet.name, index));

  const entries: ZipEntry[] = [
    { name: "[Content_Types].xml", data: encoder.encode(contentTypesXml(sheets.length)) },
    { name: "_rels/.rels", data: encoder.encode(ROOT_RELS_XML) },
    { name: "xl/workbook.xml", data: encoder.encode(workbookXml(names)) },
    { name: "xl/_rels/workbook.xml.rels", data: encoder.encode(workbookRelsXml(sheets.length)) },
    { name: "xl/styles.xml", data: encoder.encode(STYLES_XML) },
    ...sheets.map((sheet, index) => ({
      name: `xl/worksheets/sheet${index + 1}.xml`,
      data: encoder.encode(sheetXml(sheet)),
    })),
  ];

  return zip(entries, options.modified ?? new Date());
}
