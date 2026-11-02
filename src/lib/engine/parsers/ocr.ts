/**
 * OCR for scanned (image-only) PDF statements.
 * Each page is rendered to an image, read with Tesseract (English + French, bundled
 * locally so no network is needed), and returned as positioned words in PDF points,
 * so the same layout reader handles scanned and text PDFs.
 */
import { copyFile, mkdir, access } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Word } from "./pdf";

const SCALE = 3; // render at 216 dpi; good accuracy for 8–10pt statement text
const MAX_PAGES = 20;

/** True when every OCR dependency can actually be loaded (they're optional at deploy time). */
export async function ocrAvailable(): Promise<boolean> {
  try {
    await Promise.all([import("tesseract.js"), import("@napi-rs/canvas"), import("pdfjs-dist/legacy/build/pdf.mjs"), import("@tesseract.js-data/eng")]);
    return true;
  } catch {
    return false;
  }
}

/** Put eng + fra language files in one folder, which is what Tesseract expects. */
async function langDir(): Promise<string> {
  const dir = process.env.TESSDATA_DIR || path.join(os.tmpdir(), "ledgeriq-tessdata");
  await mkdir(dir, { recursive: true });
  // Literal package names so bundlers don't try to pack the (binary) language data.
  const load = async (m: Promise<{ default?: { langPath: string }; langPath?: string }>) => { const x = await m; return (x.default ?? x) as { langPath: string }; };
  const packs: [string, { langPath: string }][] = [["eng", await load(import("@tesseract.js-data/eng"))], ["fra", await load(import("@tesseract.js-data/fra"))]];
  for (const [code, pkg] of packs) {
    const target = path.join(dir, `${code}.traineddata.gz`);
    try { await access(target); continue; } catch { /* copy below */ }
    await copyFile(path.join(pkg.langPath, `${code}.traineddata.gz`), target);
  }
  return dir;
}

interface TWord { text: string; confidence: number; bbox: { x0: number; y0: number; x1: number; y1: number } }
interface TBlock { paragraphs: { lines: { words: TWord[]; bbox: { y0: number; y1: number } }[] }[] }

/** Render one page to PNG with the standard pdf.js build and @napi-rs/canvas. */
async function renderPage(pdf: import("pdfjs-dist").PDFDocumentProxy, n: number): Promise<Buffer> {
  const { createCanvas } = await import("@napi-rs/canvas");
  const page = await pdf.getPage(n);
  const viewport = page.getViewport({ scale: SCALE });
  const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvas: canvas as unknown as HTMLCanvasElement, canvasContext: ctx as unknown as CanvasRenderingContext2D, viewport }).promise;
  return canvas.toBuffer("image/png");
}

export async function ocrPdfWords(buf: Buffer): Promise<Word[]> {
  const { openPdf } = await import("./pdf");
  const { createWorker } = await import("tesseract.js");
  const pdf = await openPdf(buf);
  const worker = await createWorker(["eng", "fra"], 1, { langPath: await langDir(), gzip: true, cacheMethod: "none" });
  const words: Word[] = [];
  try {
    for (let p = 1; p <= Math.min(pdf.numPages, MAX_PAGES); p++) {
      const png = await renderPage(pdf, p);
      const { data } = await worker.recognize(png, {}, { blocks: true });
      for (const b of (data.blocks ?? []) as TBlock[])
        for (const para of b.paragraphs)
          for (const line of para.lines)
            for (const w of line.words) {
              if (!w.text.trim() || w.confidence < 30) continue;
              // Use the middle of the word's box: robust to descenders and a slightly tilted scan.
              words.push({ page: p, x: w.bbox.x0 / SCALE, x2: w.bbox.x1 / SCALE, y: (w.bbox.y0 + w.bbox.y1) / 2 / SCALE, str: w.text });
            }
    }
  } finally {
    await worker.terminate();
  }
  return words;
}
