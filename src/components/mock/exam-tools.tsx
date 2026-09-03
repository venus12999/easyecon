import { useEffect, useRef, useState, type MouseEvent } from "react";
import { Delete, X } from "lucide-react";
import { cn } from "@/lib/utils";

export type HlColor = "yellow" | "pink" | "blue";

export const HL_BG: Record<HlColor, string> = {
  yellow: "#fde68a",
  pink: "#fbcfe8",
  blue: "#bfdbfe",
};

export function unwrapHighlightSpan(span: HTMLSpanElement) {
  const parent = span.parentNode;
  if (!parent) return;
  while (span.firstChild) parent.insertBefore(span.firstChild, span);
  parent.removeChild(span);
  parent.normalize();
}

function toJsExpr(expr: string) {
  let safe = expr.replace(/[^0-9+\-*/().√ ]/g, "");
  safe = safe.replace(/√\s*\(/g, "Math.sqrt(");
  safe = safe.replace(/√\s*(\d+(?:\.\d+)?)/g, "Math.sqrt($1)");
  safe = safe.replace(/√/g, "Math.sqrt");
  return safe;
}

export function CalculatorModal({ onClose }: { onClose: () => void }) {
  const [expr, setExpr] = useState("");
  const [result, setResult] = useState<string>("");
  const press = (s: string) => setExpr((e) => e + s);
  const evalExpr = () => {
    try {
      const v = Function(`"use strict"; return (${toJsExpr(expr)})`)();
      setResult(String(v));
    } catch {
      setResult("Error");
    }
  };
  const keys = [
    ["(", ")", "√", "÷"],
    ["7", "8", "9", "×"],
    ["4", "5", "6", "−"],
    ["1", "2", "3", "+"],
    ["0", ".", "ans", "="],
  ];
  const map: Record<string, string> = { "÷": "/", "×": "*", "−": "-" };
  return (
    <div className="fixed inset-x-3 top-[4.5rem] z-[55] mx-auto w-auto max-w-[340px] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl sm:inset-x-auto sm:left-auto sm:right-6 sm:mx-0 sm:w-[340px]">
      <div className="flex items-center justify-between bg-slate-900 px-3 py-2 text-white">
        <span className="text-sm font-semibold">Calculator</span>
        <button type="button" onClick={onClose}><X className="h-4 w-4" /></button>
      </div>
      <div className="space-y-2 bg-slate-50 p-3">
        <div className="flex h-9 items-center justify-end overflow-x-auto rounded border border-slate-300 bg-white px-2 text-right font-mono text-sm">{expr || "\u00A0"}</div>
        <div className="flex h-12 items-center justify-end overflow-x-auto rounded border-2 border-blue-600 bg-white px-2 text-right font-mono text-lg">{result || "\u00A0"}</div>
        <div className="flex items-center justify-between px-1">
          <button type="button" onClick={() => setExpr("")} className="text-xs text-slate-600 hover:text-slate-900">clear all</button>
          <button type="button" onClick={() => setExpr((e) => e.slice(0, -1))} className="text-slate-600 hover:text-slate-900"><Delete className="h-4 w-4" /></button>
        </div>
        <div className="grid grid-cols-4 gap-1.5">
          {keys.flat().map((k) => {
            const isOp = ["÷", "×", "−", "+", "=", "√", "(", ")"].includes(k);
            return (
              <button
                key={k}
                type="button"
                onClick={() => {
                  if (k === "=") return evalExpr();
                  if (k === "ans") return setExpr((e) => e + result);
                  press(map[k] ?? k);
                }}
                className={cn(
                  "h-10 rounded text-sm font-semibold",
                  k === "=" ? "bg-blue-600 text-white hover:bg-blue-700" : isOp ? "bg-white border border-slate-300 hover:bg-slate-100" : "bg-slate-200 hover:bg-slate-300",
                )}
              >
                {k}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function HighlightRemoveMenu({
  target,
  onClose,
  onRemove,
}: {
  target: { x: number; y: number; span: HTMLSpanElement } | null;
  onClose: () => void;
  onRemove: () => void;
}) {
  if (!target) return null;
  return (
    <>
      <button type="button" className="fixed inset-0 z-[70] cursor-default" aria-label="关闭" onClick={onClose} />
      <div
        role="dialog"
        className="fixed z-[71] w-44 -translate-x-1/2 rounded-xl border border-slate-200 bg-white px-3 py-2.5 shadow-lg"
        style={{ left: target.x, top: target.y }}
      >
        <p className="mb-2 text-xs text-slate-500">要删除这段高亮吗？</p>
        <div className="flex gap-2">
          <button type="button" className="rounded-md bg-slate-900 px-2.5 py-1 text-xs text-white" onClick={onRemove}>
            删除
          </button>
          <button type="button" className="rounded-md border px-2.5 py-1 text-xs text-slate-600" onClick={onClose}>
            取消
          </button>
        </div>
      </div>
    </>
  );
}

export function HighlightColorBar({
  hlColor,
  setHlColor,
  className,
}: {
  hlColor: HlColor;
  setHlColor: (c: HlColor) => void;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center gap-1.5", className)}>
      {(["yellow", "pink", "blue"] as HlColor[]).map((c) => (
        <button
          key={c}
          type="button"
          onClick={() => setHlColor(c)}
          title={c}
          className={cn(
            "h-4 w-4 rounded-full border-2 transition-all",
            hlColor === c ? "scale-110 border-slate-900" : "border-transparent",
          )}
          style={{ backgroundColor: HL_BG[c] }}
        />
      ))}
      <span className="text-[10px] text-slate-500">点高亮文字可删除</span>
    </div>
  );
}

export function useExamHighlights(resetKey: number | string) {
  const stemRef = useRef<HTMLDivElement | null>(null);
  const skipHlClickRef = useRef(false);
  const [highlightActive, setHighlightActive] = useState(false);
  const [hlColor, setHlColor] = useState<HlColor>("yellow");
  const [hlRemove, setHlRemove] = useState<{ x: number; y: number; span: HTMLSpanElement } | null>(null);

  useEffect(() => {
    setHlRemove(null);
  }, [resetKey, highlightActive]);

  function applyHighlight(color: HlColor, container: HTMLElement | null) {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    if (!container || !container.contains(range.commonAncestorContainer)) return;
    const frag = range.extractContents();
    const span = document.createElement("span");
    span.setAttribute("data-hl", color);
    span.style.backgroundColor = HL_BG[color];
    span.style.borderRadius = "2px";
    span.style.cursor = "pointer";
    span.appendChild(frag);
    range.insertNode(span);
    sel.removeAllRanges();
    skipHlClickRef.current = true;
  }

  function onHighlightableMouseUp(container: HTMLElement | null) {
    if (!highlightActive) return;
    applyHighlight(hlColor, container);
  }

  function onHighlightClick(e: MouseEvent<HTMLElement>) {
    if (!highlightActive) return;
    if (skipHlClickRef.current) {
      skipHlClickRef.current = false;
      return;
    }
    const span = (e.target as HTMLElement).closest("span[data-hl]") as HTMLSpanElement | null;
    if (!span || !e.currentTarget.contains(span)) return;
    e.preventDefault();
    e.stopPropagation();
    window.getSelection()?.removeAllRanges();
    const rect = span.getBoundingClientRect();
    const x = Math.min(Math.max(88, rect.left + rect.width / 2), window.innerWidth - 88);
    const y = Math.min(rect.bottom + 8, window.innerHeight - 88);
    setHlRemove({ x, y, span });
  }

  function consumePendingHighlightClick() {
    if (!skipHlClickRef.current) return false;
    skipHlClickRef.current = false;
    return true;
  }

  return {
    stemRef,
    highlightActive,
    setHighlightActive,
    hlColor,
    setHlColor,
    hlRemove,
    setHlRemove,
    onHighlightableMouseUp,
    onHighlightClick,
    consumePendingHighlightClick,
  };
}
