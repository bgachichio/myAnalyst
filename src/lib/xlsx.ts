/**
 * A spreadsheet turned into lines of text, with no dependency.
 *
 * The obvious library for this carries a published prototype-pollution
 * advisory in the version npm serves, and the fixed build lives outside the
 * registry where it cannot be pinned or audited. An .xlsx is a zip of XML, the
 * browser can inflate a zip natively, and the two files that matter are
 * regular machine-generated markup. So this reads it directly: about two
 * hundred lines, nothing to keep patched, and nothing that can reach beyond
 * the sheet it was handed.
 *
 * It reads values, not formulas. A cell holding "=B4*1000" contributes the
 * cached result the writing application stored, which is what a reader sees.
 */
import type { Line } from "./extract.js";
import { parseNumbers } from "./extract.js";

// ---------------------------------------------------------------- zip

interface ZipEntry {
  name: string;
  method: number;
  offset: number;
  compressedSize: number;
}

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;

function findEocd(view: DataView): number {
  // The comment field is variable-length, so the record is found by scanning
  // back from the end. 65,557 is the largest a comment can make it.
  const start = Math.max(0, view.byteLength - 65_557);
  for (let i = view.byteLength - 22; i >= start; i -= 1) {
    if (view.getUint32(i, true) === EOCD) return i;
  }
  throw new Error("This is not a zip archive, so it is not an .xlsx file.");
}

function readDirectory(buffer: ArrayBuffer): ZipEntry[] {
  const view = new DataView(buffer);
  const eocd = findEocd(view);
  const count = view.getUint16(eocd + 10, true);
  let at = view.getUint32(eocd + 16, true);
  const decoder = new TextDecoder();
  const entries: ZipEntry[] = [];

  for (let i = 0; i < count; i += 1) {
    if (view.getUint32(at, true) !== CENTRAL) break;
    const method = view.getUint16(at + 10, true);
    const compressedSize = view.getUint32(at + 20, true);
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    const offset = view.getUint32(at + 42, true);
    const name = decoder.decode(new Uint8Array(buffer, at + 46, nameLength));
    entries.push({ name, method, offset, compressedSize });
    at += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

async function readEntry(buffer: ArrayBuffer, entry: ZipEntry): Promise<string> {
  const view = new DataView(buffer);
  const nameLength = view.getUint16(entry.offset + 26, true);
  const extraLength = view.getUint16(entry.offset + 28, true);
  const start = entry.offset + 30 + nameLength + extraLength;
  const raw = new Uint8Array(buffer, start, entry.compressedSize);

  if (entry.method === 0) return new TextDecoder().decode(raw);
  if (entry.method !== 8) throw new Error(`${entry.name} uses an unsupported compression method.`);

  const stream = new Blob([raw]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Response(stream).text();
}

// ---------------------------------------------------------------- xml

const ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'",
};

export function decodeXml(text: string): string {
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-z]+);/g, (whole, body: string) => {
    if (body.startsWith("#x") || body.startsWith("#X")) return String.fromCodePoint(parseInt(body.slice(2), 16));
    if (body.startsWith("#")) return String.fromCodePoint(Number(body.slice(1)));
    return ENTITIES[body] ?? whole;
  });
}

/** The strings a workbook shares between cells, in the order cells refer to them. */
export function parseSharedStrings(xml: string): string[] {
  const out: string[] = [];
  for (const si of xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)) {
    let text = "";
    for (const t of si[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)) text += decodeXml(t[1]);
    out.push(text);
  }
  return out;
}

/** Sheet names in workbook order, so a line can say which sheet it came from. */
export function parseSheetNames(xml: string): string[] {
  return [...xml.matchAll(/<sheet\b[^>]*\bname="([^"]*)"/g)].map((m) => decodeXml(m[1]));
}

const number = (value: number): string =>
  Number.isInteger(value) ? String(value) : String(Number(value.toFixed(6)));

/** One row of cells becomes one line of text, columns separated as in a printed table. */
export function parseSheet(xml: string, shared: string[]): string[] {
  const rows: string[] = [];
  for (const row of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells: string[] = [];
    for (const cell of row[1].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
      const type = /\bt="([^"]*)"/.exec(cell[1])?.[1] ?? "n";
      const body = cell[2];
      let text = "";
      if (type === "s") {
        const index = Number(/<v>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? "-1");
        text = shared[index] ?? "";
      } else if (type === "inlineStr") {
        for (const t of body.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)) text += decodeXml(t[1]);
      } else {
        const value = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
        if (value === undefined) text = "";
        else if (type === "str" || type === "e") text = decodeXml(value);
        else {
          const n = Number(value);
          text = Number.isFinite(n) ? number(n) : decodeXml(value);
        }
      }
      if (text.trim() !== "") cells.push(text.trim());
    }
    if (cells.length) rows.push(cells.join("   "));
  }
  return rows;
}

// ---------------------------------------------------------------- reading

export async function readXlsx(file: File | ArrayBuffer): Promise<Line[]> {
  const buffer = file instanceof ArrayBuffer ? file : await file.arrayBuffer();
  const entries = readDirectory(buffer);
  const byName = new Map(entries.map((e) => [e.name, e]));

  const workbook = byName.get("xl/workbook.xml");
  if (!workbook) {
    throw new Error(
      "No xl/workbook.xml inside. If this is an older .xls, open it once and save it as .xlsx.",
    );
  }
  const names = parseSheetNames(await readEntry(buffer, workbook));

  const sharedEntry = byName.get("xl/sharedStrings.xml");
  const shared = sharedEntry ? parseSharedStrings(await readEntry(buffer, sharedEntry)) : [];

  // Sheets are numbered in workbook order by the writing application. Reading
  // the relationship file back would be stricter; every writer in practice
  // names them sheet1..sheetN, and a missing file is skipped rather than fatal.
  const sheets = entries
    .filter((e) => /^xl\/worksheets\/sheet\d+\.xml$/.test(e.name))
    .sort((a, b) => sheetNumber(a.name) - sheetNumber(b.name));

  const lines: Line[] = [];
  for (const [index, sheet] of sheets.entries()) {
    const page = names[index] ?? `sheet ${index + 1}`;
    for (const text of parseSheet(await readEntry(buffer, sheet), shared)) {
      lines.push({ page, text, numbers: parseNumbers(text) });
    }
  }
  if (lines.length === 0) throw new Error("The workbook has no rows this reader could see.");
  return lines;
}

const sheetNumber = (name: string): number => Number(/sheet(\d+)\.xml$/.exec(name)?.[1] ?? 0);
