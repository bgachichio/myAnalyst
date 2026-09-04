/**
 * A PDF turned into lines of text, with the page each line came from.
 *
 * pdf.js gives back positioned text runs, not lines. A financial statement is
 * a table drawn with whitespace, so the runs have to be grouped back into rows
 * by their vertical position before any label means anything.
 *
 * Imported lazily: pdf.js is the largest thing in the bundle and most sessions
 * never open a PDF.
 */
import type { Line } from "./extract.js";
import { parseNumbers } from "./extract.js";

/** Two runs within this many points of each other are on the same line. */
const ROW_TOLERANCE = 3;

/** A gap wider than this reads as a column break, so it becomes whitespace. */
const COLUMN_GAP = 6;

interface Run {
  text: string;
  x: number;
  y: number;
  width: number;
}

const inBrowser = (): boolean => typeof window !== "undefined";

/**
 * pdf.js ships two builds and asks, on stderr, for the legacy one off the
 * browser. The legacy specifier is held in a variable so the bundler leaves
 * that branch alone: it can never run in a browser, and a second copy of
 * pdf.js in the bundle is a megabyte bought for nothing.
 */
function loadPdfjs(): Promise<typeof import("pdfjs-dist")> {
  if (inBrowser()) return import("pdfjs-dist");
  const legacy = "pdfjs-dist/legacy/build/pdf.mjs";
  return import(/* @vite-ignore */ legacy) as Promise<typeof import("pdfjs-dist")>;
}

export interface PdfProgress {
  page: number;
  pages: number;
}

export async function readPdf(
  file: File | ArrayBuffer,
  onProgress?: (p: PdfProgress) => void,
): Promise<Line[]> {
  const pdfjs = await loadPdfjs();
  // The worker ships with the package. Bundled by Vite as an asset URL rather
  // than fetched from a CDN, so the app keeps working offline and the content
  // security policy stays closed. Off the browser there is no worker to load
  // and pdf.js runs on the main thread, which is what lets the whole path be
  // tested without one.
  if (inBrowser() && !pdfjs.GlobalWorkerOptions.workerSrc) {
    const workerUrl = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
    pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  }

  const data = file instanceof ArrayBuffer ? file : await file.arrayBuffer();
  const task = pdfjs.getDocument({ data: new Uint8Array(data) });
  const doc = await task.promise;
  const lines: Line[] = [];

  try {
    for (let n = 1; n <= doc.numPages; n += 1) {
      onProgress?.({ page: n, pages: doc.numPages });
      const page = await doc.getPage(n);
      const content = await page.getTextContent();

      const runs: Run[] = [];
      for (const item of content.items) {
        // The other half of the union is a marked-content marker, which has no
        // text and no position, so it is skipped rather than coerced.
        if (!("str" in item) || item.str.trim() === "") continue;
        runs.push({ text: item.str, x: item.transform[4], y: item.transform[5], width: item.width });
      }

      for (const text of groupIntoRows(runs)) {
        lines.push({ page: `page ${n}`, text, numbers: parseNumbers(text) });
      }
      page.cleanup();
    }
  } finally {
    // Tearing down the loading task stops the worker; leaving it running holds
    // the whole document in memory for the rest of the session.
    await task.destroy();
  }
  return lines;
}

/** Runs sharing a baseline become one row; wide gaps become double spaces. */
export function groupIntoRows(runs: Run[]): string[] {
  const rows: Run[][] = [];
  for (const run of [...runs].sort((a, b) => b.y - a.y || a.x - b.x)) {
    const row = rows[rows.length - 1];
    if (row && Math.abs(row[0].y - run.y) <= ROW_TOLERANCE) row.push(run);
    else rows.push([run]);
  }
  return rows.map((row) => {
    const sorted = row.sort((a, b) => a.x - b.x);
    let text = "";
    let cursor = -Infinity;
    for (const run of sorted) {
      if (cursor !== -Infinity && run.x - cursor > COLUMN_GAP) text += "   ";
      else if (text !== "" && !text.endsWith(" ") && !run.text.startsWith(" ")) text += " ";
      text += run.text;
      cursor = run.x + run.width;
    }
    return text.replace(/\s+$/, "");
  }).filter((t) => t.trim() !== "");
}
