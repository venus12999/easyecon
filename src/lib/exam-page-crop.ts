/** Question images are the table/graph only. Stem and choices stay as extracted text. */

export type TextBox = { str: string; x: number; y: number; w: number; h: number };

export type RasterPageCrop = {
  page_number: number;
  width: number;
  height: number;
  boxes: TextBox[];
};

export type CropSlice = { x: number; y: number; w: number; h: number; prefer?: "end" | "largest" };

export type CropPlan = {
  page_number: number;
  slices: CropSlice[];
  mode?: "body" | "figure";
  hinted?: boolean;
};

type ParsedLike = {
  kind: "mcq" | "frq";
  sort_order: number;
  page_number: number;
  needs_image?: boolean;
  stem?: string;
};

type Marker = { n: number; x: number; y: number; h: number; col: "L" | "R" };

function itemKey(kind: string, sort: number) {
  return `${kind}-${sort}`;
}

function clampSlice(page: RasterPageCrop, slice: CropSlice): CropSlice {
  const x = Math.max(0, Math.min(page.width - 1, Math.floor(slice.x)));
  const y = Math.max(0, Math.min(page.height - 1, Math.floor(slice.y)));
  const w = Math.max(1, Math.min(page.width - x, Math.floor(slice.w)));
  const h = Math.max(1, Math.min(page.height - y, Math.floor(slice.h)));
  return { ...slice, x, y, w, h };
}

function questionMarkers(page: RasterPageCrop): Marker[] {
  const top = page.height * 0.06;
  const bottom = page.height * 0.92;
  const leftMax = page.width * 0.22;
  const rightMin = page.width * 0.45;
  const rightMax = page.width * 0.68;
  const hits: Marker[] = [];
  for (const box of page.boxes) {
    if (box.y < top || box.y > bottom) continue;
    const t = box.str.trim();
    const m = t.match(/^(\d{1,2})\./) || t.match(/^(\d{1,2})$/);
    if (!m) continue;
    const n = Number(m[1]);
    if (n < 1 || n > 60) continue;
    let col: "L" | "R" | null = null;
    if (box.x <= leftMax) col = "L";
    else if (box.x >= rightMin && box.x <= rightMax) col = "R";
    if (!col) continue;
    hits.push({ n, x: box.x, y: box.y, h: Math.max(box.h, 14), col });
  }
  hits.sort((a, b) => a.y - b.y || a.x - b.x);
  const uniq: Marker[] = [];
  for (const hit of hits) {
    const prev = uniq.find((x) => x.n === hit.n && x.col === hit.col && Math.abs(x.y - hit.y) < 24);
    if (!prev) uniq.push(hit);
  }
  return uniq;
}

function twoColumn(markers: Marker[]) {
  return markers.some((m) => m.col === "L") && markers.some((m) => m.col === "R");
}

function columnBand(page: RasterPageCrop, col: "L" | "R", split: boolean, kind: "mcq" | "frq") {
  if (kind === "frq" || !split) {
    return { x: Math.round(page.width * 0.04), w: Math.round(page.width * 0.92) };
  }
  const mid = Math.round(page.width * 0.5);
  const gutter = Math.max(12, Math.round(page.width * 0.018));
  if (col === "L") {
    const x = Math.round(page.width * 0.04);
    return { x, w: mid - gutter - x };
  }
  const x = mid + gutter;
  return { x, w: Math.round(page.width * 0.96) - x };
}

function inColumn(page: RasterPageCrop, box: TextBox, col: "L" | "R") {
  const mid = page.width * 0.49;
  return col === "L" ? box.x < mid : box.x >= mid - 24;
}

function sharedStimulus(page: RasterPageCrop, col: "L" | "R") {
  const re = /questions?\s+(\d+)\s*[-–]\s*(\d+)/i;
  for (const box of page.boxes) {
    if (!inColumn(page, box, col)) continue;
    const group = page.boxes.filter((b) => inColumn(page, b, col) && Math.abs(b.y - box.y) < 22);
    const window = group.map((b) => b.str).join(" ");
    const m = window.match(re);
    if (!m) continue;
    return {
      from: Number(m[1]),
      until: Number(m[2]),
      y: Math.min(...group.map((b) => b.y)),
    };
  }
  return null;
}

function choiceMarkerY(page: RasterPageCrop, col: "L" | "R", afterY: number, split: boolean, kind: "mcq" | "frq") {
  const re = kind === "frq" ? /^\(a\)/i : /^\(A\)/;
  let best: number | null = null;
  for (const box of page.boxes) {
    if (split && !inColumn(page, box, col)) continue;
    if (box.y <= afterY + 6) continue;
    if (!re.test(box.str.trim())) continue;
    if (best == null || box.y < best) best = box.y;
  }
  return best;
}

function pushWindow(page: RasterPageCrop, slices: CropSlice[], band: { x: number; w: number }, y0: number, y1: number, prefer: CropSlice["prefer"]) {
  const h = y1 - y0;
  if (h < 48) return;
  slices.push(clampSlice(page, { x: band.x, y: y0, w: band.w, h, prefer }));
}

/**
 * For every parsed item, locate its column on the page and record the windows
 * where a table/graph usually sits: above the question number (shared stimulus)
 * and between the stem and (A). Pixel clustering later keeps only the figure.
 */
export function cropRectsForQuestions(pages: RasterPageCrop[], items: ParsedLike[]): Map<string, CropPlan> {
  const byPage = new Map(pages.map((p) => [p.page_number, p]));
  const out = new Map<string, CropPlan>();

  for (const it of items) {
    if (!it.needs_image) continue;
    const page = byPage.get(it.page_number);
    if (!page) continue;
    const markers = questionMarkers(page);
    const split = it.kind === "mcq" && twoColumn(markers);
    const mine = markers.filter((m) => m.n === it.sort_order).sort((a, b) => a.y - b.y)[0];
    if (!mine) {
      const top = Math.round(page.height * 0.07);
      out.set(itemKey(it.kind, it.sort_order), {
        page_number: page.page_number,
        mode: "figure",
        hinted: true,
        slices: [clampSlice(page, { x: Math.round(page.width * 0.04), y: top, w: Math.round(page.width * 0.92), h: page.height * 0.5, prefer: "largest" })],
      });
      continue;
    }
    const col = mine.col;
    const band = columnBand(page, col, split, it.kind);
    const sameCol = markers.filter((m) => !split || m.col === col);
    const next = sameCol.find((m) => m.y > mine.y + 10 && m.n !== it.sort_order);
    const stim = sharedStimulus(page, col);
    const inShared = !!(stim && it.sort_order >= stim.from && it.sort_order <= stim.until);
    const first = inShared && stim ? (sameCol.find((m) => m.n === stim.from) ?? mine) : mine;
    const prev = [...sameCol].reverse().find((m) => m.y < first.y - 12);
    const header = Math.round(page.height * 0.07);
    const aY = choiceMarkerY(page, col, mine.y, split, it.kind);
    const slices: CropSlice[] = [];
    const aboveTop = inShared && stim ? stim.y - 6 : prev ? prev.y + 28 : header;
    pushWindow(page, slices, band, aboveTop, first.y - 4, "end");
    if (aY) pushWindow(page, slices, band, mine.y + 8, aY - 6, "largest");
    if (slices.length === 0) {
      const y1 = next ? next.y - 4 : page.height * 0.88;
      pushWindow(page, slices, band, Math.max(header, mine.y - 8), y1, "largest");
    }
    if (slices.length === 0) continue;
    out.set(itemKey(it.kind, it.sort_order), {
      page_number: page.page_number,
      mode: "figure",
      hinted: !!it.needs_image,
      slices,
    });
  }
  return out;
}

function isInk(data: Uint8ClampedArray, i: number) {
  return data[i] < 248 || data[i + 1] < 248 || data[i + 2] < 248;
}

type RowKind = "empty" | "text" | "rule" | "figure";

function classifyRow(data: Uint8ClampedArray, w: number, h: number, py: number, step: number): RowKind {
  if (py < 0 || py >= h) return "empty";
  const xs: number[] = [];
  for (let px = 0; px < w; px += step) {
    if (isInk(data, (py * w + px) * 4)) xs.push(px);
  }
  const samples = Math.max(1, Math.ceil(w / step));
  if (xs.length < 2) return "empty";
  let runs = 1;
  let longRun = 1;
  let cur = 1;
  for (let i = 1; i < xs.length; i++) {
    if (xs[i] - xs[i - 1] <= step) {
      cur++;
    } else {
      runs++;
      longRun = Math.max(longRun, cur);
      cur = 1;
    }
  }
  longRun = Math.max(longRun, cur);
  const longFrac = longRun / samples;
  const coverage = xs.length / samples;
  const covUp = py >= step ? rowCoverage(data, w, py - step, step) : 0;
  const covDn = py + step < h ? rowCoverage(data, w, py + step, step) : 0;
  const looksLine = coverage >= 0.15 && longFrac >= 0.14 && coverage >= covUp * 2.1 && coverage >= covDn * 2.1;
  const nearInk = covUp >= 0.035 || covDn >= 0.035;
  if (nearInk && coverage >= 0.03 && coverage <= 0.26 && longFrac < 0.25 && runs >= 3 && runs <= 22) return "figure";
  if (coverage >= 0.1 && runs >= 5 && longFrac < 0.38 && coverage <= 0.7) return "text";
  if (coverage >= 0.16 && runs >= 4 && longFrac < 0.3) return "text";
  if (runs <= 3 && longFrac >= 0.2 && coverage >= longFrac * 0.65) return "rule";
  if (looksLine && runs <= 8) return "rule";
  if (coverage < 0.025) return "empty";
  return "figure";
}

function rowCoverage(data: Uint8ClampedArray, w: number, py: number, step: number) {
  let n = 0;
  let t = 0;
  for (let px = 0; px < w; px += step) {
    t++;
    if (isInk(data, (py * w + px) * 4)) n++;
  }
  return n / Math.max(1, t);
}

function isCore(kind: RowKind) {
  return kind === "rule" || kind === "figure";
}

function lookKind(kinds: RowKind[], from: number, maxPx: number, step: number, pred: (k: RowKind) => boolean) {
  const last = Math.min(kinds.length - 1, from + Math.ceil(maxPx / step));
  for (let i = from; i <= last; i++) if (pred(kinds[i])) return i;
  return -1;
}

function figureBands(
  kinds: RowKind[],
  data: Uint8ClampedArray,
  w: number,
  step: number,
): { y0: number; y1: number; rules: number; figures: number; text: number }[] {
  const n = kinds.length;
  type Run = { start: number; end: number; rules: number; figures: number; text: number };
  const stats = (start: number, end: number): Run => {
    let rules = 0;
    let figures = 0;
    let text = 0;
    for (let k = start; k <= end; k++) {
      if (kinds[k] === "rule") rules++;
      else if (kinds[k] === "figure") figures++;
      else if (kinds[k] === "text") text++;
    }
    return { start, end, rules, figures, text };
  };
  const raw: Run[] = [];
  let i = 0;
  while (i < n) {
    while (i < n && !isCore(kinds[i])) i++;
    if (i >= n) break;
    let end = i;
    let j = i + 1;
    while (j < n) {
      if (isCore(kinds[j])) {
        end = j;
        j++;
        continue;
      }
      if (kinds[j] === "empty" && lookKind(kinds, j, 10, step, isCore) >= 0) {
        j = lookKind(kinds, j, 10, step, isCore);
        continue;
      }
      break;
    }
    raw.push(stats(i, end));
    i = end + 1;
  }
  const merged: Run[] = [];
  for (const run of raw) {
    const prev = merged.at(-1);
    if (!prev) {
      merged.push({ ...run });
      continue;
    }
    let maxCov = 0;
    let textRows = 0;
    let onlyEmpty = true;
    for (let t = prev.end + 1; t < run.start; t++) {
      if (kinds[t] !== "empty") onlyEmpty = false;
      if (kinds[t] !== "text") continue;
      textRows++;
      maxCov = Math.max(maxCov, rowCoverage(data, w, t * step, step));
    }
    const gapPx = (run.start - prev.end) * step;
    const bothRules = prev.rules >= 1 && run.rules >= 1;
    const paragraph = !bothRules && gapPx >= 36 && textRows >= 5;
    const filled = textRows * step >= gapPx * 0.45;
    const sentence = !bothRules && !filled && textRows >= 3 && maxCov >= 0.2 && gapPx >= 24;
    const glueTable = !onlyEmpty && !paragraph && gapPx <= 64 && bothRules;
    const glueLabel = !onlyEmpty && !paragraph && !sentence && gapPx <= 44 && maxCov < 0.32 && textRows <= 12;
    const glueTight = onlyEmpty && gapPx <= 14;
    const glueGraph = onlyEmpty && gapPx <= 56 && prev.figures >= 8 && run.figures >= 8;
    const glueGraphAxis =
      onlyEmpty &&
      gapPx <= 56 &&
      ((prev.figures >= 20 && (run.rules >= 1 || run.figures >= 8)) ||
        (run.figures >= 20 && (prev.rules >= 1 || prev.figures >= 8)));
    const glueGraphNear =
      onlyEmpty && gapPx <= 24 && Math.min(prev.figures, run.figures) >= 4 && Math.max(prev.figures, run.figures) >= 8;
    const gluePlot =
      !paragraph &&
      !sentence &&
      gapPx <= 28 &&
      textRows <= 6 &&
      maxCov < 0.28 &&
      prev.figures >= 6 &&
      run.figures >= 6;
    const glueTableEmpty = onlyEmpty && bothRules && gapPx <= 64;
    const glueAdjacent =
      gapPx <= 8 && prev.rules + prev.figures >= 8 && run.rules + run.figures >= 8;
    const glueRuleFig =
      !sentence &&
      prev.rules + run.rules >= 1 &&
      prev.figures + run.figures >= 1 &&
      (gapPx <= 16 ||
        (!onlyEmpty && gapPx <= 28 && (textRows <= 3 || filled)) ||
        (onlyEmpty && gapPx <= 24 && Math.min(prev.figures, run.figures) >= 8));
    if (
      glueTable ||
      glueLabel ||
      glueTight ||
      glueGraph ||
      glueGraphAxis ||
      glueGraphNear ||
      gluePlot ||
      glueTableEmpty ||
      glueAdjacent ||
      glueRuleFig
    ) {
      prev.end = run.end;
      prev.rules += run.rules;
      prev.figures += run.figures;
      prev.text += run.text + textRows;
      continue;
    }
    merged.push({ ...run });
  }
  return merged.map((r) => ({ y0: r.start * step, y1: r.end * step + step, rules: r.rules, figures: r.figures, text: r.text }));
}

function densestXSpan(data: Uint8ClampedArray, w: number, y0: number, y1: number, step: number) {
  const cols = Math.max(1, Math.ceil(w / step));
  const colInk = new Int16Array(cols);
  for (let py = Math.max(0, y0); py <= y1; py += step) {
    for (let px = 0; px < w; px += step) {
      if (isInk(data, (py * w + px) * 4)) colInk[Math.floor(px / step)]++;
    }
  }
  let peak = 0;
  for (let i = 0; i < cols; i++) peak = Math.max(peak, colInk[i]);
  const thresh = Math.max(2, peak * 0.22);
  const active = Array.from(colInk, (v) => v >= thresh);
  const hole = 6;
  for (let i = 0; i < cols; i++) {
    if (active[i]) continue;
    let l = i - 1;
    let r = i + 1;
    while (l >= 0 && !active[l]) l--;
    while (r < cols && !active[r]) r++;
    if (l >= 0 && r < cols && r - l - 1 <= hole) active[i] = true;
  }
  let bestA = 0;
  let bestB = 0;
  let bestInk = -1;
  let a = -1;
  let ink = 0;
  for (let i = 0; i <= cols; i++) {
    const on = i < cols && active[i];
    if (on) {
      if (a < 0) {
        a = i;
        ink = 0;
      }
      ink += colInk[i];
    } else if (a >= 0) {
      if (ink > bestInk) {
        bestInk = ink;
        bestA = a;
        bestB = i - 1;
      }
      a = -1;
    }
  }
  if (bestInk < 0 || bestB - bestA < 4) return null;
  return { minX: bestA * step, maxX: (bestB + 1) * step };
}

function inkSpan(data: Uint8ClampedArray, w: number, y0: number, y1: number, x0: number, x1: number, step: number) {
  let minX = x1;
  let maxX = x0;
  let n = 0;
  for (let py = Math.max(0, y0); py <= y1; py += step) {
    for (let px = Math.max(0, x0); px < x1; px += step) {
      if (!isInk(data, (py * w + px) * 4)) continue;
      n++;
      if (px < minX) minX = px;
      if (px > maxX) maxX = px;
    }
  }
  if (n < 3 || maxX <= minX) return null;
  return { minX, maxX };
}

function clipStrayX(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  box: { minX: number; maxX: number; minY: number; maxY: number },
  y0: number,
  y1: number,
  step: number,
) {
  const rules = ruleXRange(data, w, h, y0, y1, step);
  const grid = rules ?? densestXSpan(data, w, y0, y1, step);
  if (!grid) return box;
  const pad = 12;
  if (grid.minX - box.minX > 24) {
    const stray = inkSpan(data, w, y0, y1, box.minX, grid.minX - 8, step);
    if (!stray || stray.maxX - stray.minX < 22) box.minX = Math.max(box.minX, grid.minX - pad);
  }
  if (box.maxX - grid.maxX > 24) {
    const stray = inkSpan(data, w, y0, y1, grid.maxX + 8, box.maxX + 1, step);
    if (!stray || stray.maxX - stray.minX < 22) box.maxX = Math.min(box.maxX, grid.maxX + pad);
  }
  return box;
}

function ruleXRange(data: Uint8ClampedArray, w: number, h: number, y0: number, y1: number, step: number) {
  let minX = w;
  let maxX = 0;
  let rules = 0;
  for (let py = Math.max(0, y0); py <= y1; py += step) {
    if (classifyRow(data, w, h, py, step) !== "rule") continue;
    rules++;
    let first = -1;
    let last = -1;
    for (let px = 0; px < w; px += step) {
      if (!isInk(data, (py * w + px) * 4)) continue;
      if (first < 0) first = px;
      last = px;
    }
    if (first >= 0) {
      minX = Math.min(minX, first);
      maxX = Math.max(maxX, last);
    }
  }
  if (rules < 1 || maxX <= minX) return null;
  return { minX, maxX };
}

function inkBounds(data: Uint8ClampedArray, w: number, h: number, y0: number, y1: number, step: number) {
  let minX = w;
  let maxX = 0;
  let minY = h;
  let maxY = 0;
  const top = Math.max(0, y0);
  const bot = Math.min(h - 1, y1);
  for (let py = top; py <= bot; py += step) {
    for (let px = 0; px < w; px += step) {
      if (!isInk(data, (py * w + px) * 4)) continue;
      if (px < minX) minX = px;
      if (px > maxX) maxX = px;
      if (py < minY) minY = py;
      if (py > maxY) maxY = py;
    }
  }
  if (maxX <= minX || maxY <= minY) return null;
  return { minX, maxX, minY, maxY };
}

function expandLabelRows(
  data: Uint8ClampedArray,
  kinds: RowKind[],
  w: number,
  h: number,
  band: { y0: number; y1: number; rules?: number },
  step: number,
) {
  let y0 = band.y0;
  let y1 = band.y1;
  const tableLike = (band.rules ?? 0) >= 2 && (band.figures ?? 0) <= 40;
  const labelBudget = 48;
  const emptyUp = 16;
  const emptyDown = tableLike ? 72 : 32;
  const isLabel = (y: number) => {
    const kind = kinds[Math.floor(y / step)] ?? "empty";
    if (kind === "empty") return "gap";
    if (kind === "rule" && tableLike) return "keep-rule";
    if (kind === "rule" || kind === "figure") return "stop";
    return rowCoverage(data, w, y, step) < 0.11 ? "label" : "stop";
  };
  let used = 0;
  let emptyUsed = 0;
  for (let y = band.y0 - step; y >= 0 && used < labelBudget; y -= step) {
    const hit = isLabel(y);
    if (hit === "gap") {
      emptyUsed += step;
      if (emptyUsed > emptyUp) break;
      continue;
    }
    emptyUsed = 0;
    if (hit === "label") {
      y0 = y;
      used += step;
      continue;
    }
    break;
  }
  used = 0;
  emptyUsed = 0;
  for (let y = band.y1 + step; y < h && used < labelBudget; y += step) {
    const hit = isLabel(y);
    if (hit === "gap") {
      emptyUsed += step;
      if (emptyUsed > emptyDown) break;
      continue;
    }
    emptyUsed = 0;
    if (hit === "label") {
      y1 = y;
      used += step;
      continue;
    }
    if (hit === "keep-rule") {
      y1 = y;
      break;
    }
    break;
  }
  if (tableLike) y1 = Math.min(h - 1, y1 + 10);
  return { y0, y1 };
}

function bestInkCluster(
  ctx: CanvasRenderingContext2D,
  slice: CropSlice,
  pageH: number,
  hinted: boolean,
): (CropSlice & { score: number; rules: number; figures: number }) | null {
  const x = Math.max(0, Math.floor(slice.x));
  const y = Math.max(0, Math.floor(slice.y));
  const w = Math.max(1, Math.floor(slice.w));
  const h = Math.max(1, Math.floor(slice.h));
  const img = ctx.getImageData(x, y, w, h);
  const step = 2;
  const kinds: RowKind[] = [];
  for (let py = 0; py < h; py += step) kinds.push(classifyRow(img.data, w, h, py, step));
  const bands = figureBands(kinds, img.data, w, step);
  const hasTable = bands.some((b) => b.rules >= 2);
  let best: (CropSlice & { score: number; rules: number; figures: number }) | null = null;
  let bestScore = -1;
  for (const band of bands) {
    const grown = expandLabelRows(img.data, kinds, w, h, band, step);
    const rh = grown.y1 - grown.y0;
    if (rh < 28) continue;
    if (rh > pageH * 0.85 && band.text > 15) continue;
    const structured = band.rules >= 1 || band.figures >= 14 || (hinted && band.figures >= 8);
    if (!structured) continue;
    if (hasTable && band.rules < 2 && band.figures < 50) continue;
    if (band.rules < 1 && band.text > band.figures && band.figures < 24) continue;
    const box = inkBounds(img.data, w, h, grown.y0, grown.y1, step);
    if (!box) continue;
    clipStrayX(img.data, w, h, box, grown.y0, grown.y1, step);
    const rw = box.maxX - box.minX;
    const bh = box.maxY - box.minY;
    if (rw < w * 0.12 || bh < 28) continue;
    if (rw * bh < 8000 && band.rules < 2 && band.figures < 22) continue;
    let score = rw * bh * 0.01 + band.rules * 80 + band.figures * 8 - band.text * 8;
    if (band.rules >= 2) score += 500;
    if (bh < 56 && band.rules < 2) score *= 0.2;
    if (score > bestScore) {
      bestScore = score;
      const edge = 8;
      best = {
        x: x + box.minX - edge,
        y: y + box.minY - edge,
        w: rw + edge * 2,
        h: bh + edge * 2,
        score,
        rules: band.rules,
        figures: band.figures,
      };
    }
  }
  if (best) return best;
  if (!hinted) return null;
  return null;
}

async function blobFromSlice(bmp: ImageBitmap, slice: CropSlice): Promise<Blob> {
  const x = Math.max(0, Math.min(bmp.width - 1, Math.floor(slice.x)));
  const y = Math.max(0, Math.min(bmp.height - 1, Math.floor(slice.y)));
  const w = Math.max(1, Math.min(bmp.width - x, Math.floor(slice.w)));
  const h = Math.max(1, Math.min(bmp.height - y, Math.floor(slice.h)));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("无法裁切页图");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bmp, x, y, w, h, 0, 0, w, h);
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("裁切导出失败"))), "image/png");
  });
}

export async function cropImageBlob(blob: Blob, plan: CropPlan): Promise<Blob> {
  const bmp = await createImageBitmap(blob);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = bmp.width;
    canvas.height = bmp.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("无法裁切页图");
    ctx.drawImage(bmp, 0, 0);
    let best: CropSlice | null = null;
    let bestArea = -1;
    for (const slice of plan.slices) {
      const cluster = bestInkCluster(
        ctx,
        clampSlice({ width: bmp.width, height: bmp.height, page_number: 0, boxes: [] }, slice),
        bmp.height,
        !!plan.hinted,
      );
      if (!cluster) continue;
      const area = cluster.w * cluster.h;
      if (area > bestArea) {
        bestArea = area;
        best = cluster;
      }
    }
    if (!best) throw new Error("没有找到图表区域");
    return await blobFromSlice(bmp, best);
  } finally {
    bmp.close();
  }
}

/** Recrop a figure from a full exam page when stored thumbs were already cut too small. */
export async function cropFigureFromExamPage(blob: Blob, hint: "table" | "graph" | "frq" | "any" = "any"): Promise<Blob> {
  const bmp = await createImageBitmap(blob);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = bmp.width;
    canvas.height = bmp.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("无法裁切页图");
    ctx.drawImage(bmp, 0, 0);
    const page = { width: bmp.width, height: bmp.height, page_number: 0, boxes: [] };
    const slices: CropSlice[] =
      hint === "frq"
        ? [{ x: bmp.width * 0.04, y: bmp.height * 0.06, w: bmp.width * 0.92, h: bmp.height * 0.5, prefer: "largest" }]
        : [
            { x: bmp.width * 0.04, y: bmp.height * 0.06, w: bmp.width * 0.44, h: bmp.height * 0.84, prefer: "largest" },
            { x: bmp.width * 0.52, y: bmp.height * 0.06, w: bmp.width * 0.44, h: bmp.height * 0.84, prefer: "largest" },
          ];
    let best: CropSlice | null = null;
    let bestScore = -1;
    for (const slice of slices) {
      const cluster = bestInkCluster(ctx, clampSlice(page, slice), bmp.height, true);
      if (!cluster) continue;
      let score = cluster.score;
      if (hint === "table") {
        score += cluster.rules * 200;
        if (cluster.rules >= 2) score += 1800;
        if (cluster.h < 72) score *= 0.15;
        if (cluster.h > 320 && cluster.rules < 2) score *= 0.25;
      }
      if (hint === "graph") {
        score += cluster.figures * 10;
        if (cluster.rules >= 2 && cluster.figures < 40) score *= 0.35;
      }
      if (score > bestScore) {
        bestScore = score;
        best = cluster;
      }
    }
    if (!best) throw new Error("没有找到图表区域");
    return await blobFromSlice(bmp, best);
  } finally {
    bmp.close();
  }
}

/** Re-crop an existing image so leftover stem text is dropped. */
export async function refineFigureBlob(blob: Blob): Promise<Blob> {
  try {
    return await cropImageBlob(blob, {
      page_number: 1,
      mode: "figure",
      hinted: true,
      slices: [{ x: 0, y: 0, w: 8000, h: 8000, prefer: "largest" }],
    });
  } catch {
    return blob;
  }
}

export function cropStorageName(kind: string, sort: number) {
  return `${kind}-${sort}.png`;
}

export function cropUrlFromPage(pageUrl: string, kind: string, sort: number) {
  return pageUrl.replace(/page-\d+\.(png|jpe?g|webp)$/i, cropStorageName(kind, sort));
}
