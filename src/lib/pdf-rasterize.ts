import * as pdfjs from "pdfjs-dist";
import pdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type { TextBox } from "@/lib/exam-page-crop";

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorker;

export type RasterPage = {
  page_number: number;
  blob: Blob;
  extracted_text: string;
  width: number;
  height: number;
  boxes: TextBox[];
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
    const boxes: TextBox[] = [];
    const parts: string[] = [];
    for (const raw of textContent.items) {
      if (!raw || typeof raw !== "object" || !("str" in raw)) continue;
      const item = raw as { str: string; transform: number[]; width: number; height: number };
      const str = String(item.str ?? "");
      parts.push(str);
      const [x, y] = viewport.convertToViewportPoint(item.transform[4], item.transform[5]);
      const h = Math.abs((item.transform[3] || item.height || 12) * (viewport.scale ?? scale));
      const w = Math.max(item.width * (viewport.scale ?? scale), str.length * 4);
      boxes.push({ str, x, y: y - h, w, h });
    }
    pages.push({
      page_number: i,
      blob,
      extracted_text: parts.join(" ").replace(/\s+/g, " ").trim(),
      width: canvas.width,
      height: canvas.height,
      boxes,
    });
    onProgress?.(i, doc.numPages);
  }
  return pages;
}
