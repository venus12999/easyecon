import * as pdfjs from "pdfjs-dist";
import pdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorker;

export type RasterPage = {
  page_number: number;
  blob: Blob;
  extracted_text: string;
};

export async function rasterizePdf(
  file: File,
  onProgress?: (done: number, total: number) => void,
): Promise<RasterPage[]> {
  const data = await file.arrayBuffer();
  const doc = await pdfjs.getDocument({ data }).promise;
  if (doc.numPages > 80) throw new Error("PDF 最多 80 页");
  const scale = 160 / 72;
  const pages: RasterPage[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("无法创建画布");
    await page.render({ canvasContext: ctx, viewport }).promise;
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("页图导出失败"))), "image/png");
    });
    const textContent = await page.getTextContent();
    const extracted_text = textContent.items
      .map((it) => ("str" in it ? String(it.str) : ""))
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    pages.push({ page_number: i, blob, extracted_text });
    onProgress?.(i, doc.numPages);
  }
  return pages;
}
