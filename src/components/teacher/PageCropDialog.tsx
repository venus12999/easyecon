import { useEffect, useRef, useState, type PointerEvent } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { cropRectFromBlob } from "@/lib/exam-page-crop";

type Box = { x: number; y: number; w: number; h: number };

export function PageCropDialog({
  open,
  pageUrl,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  pageUrl: string;
  onOpenChange: (open: boolean) => void;
  onConfirm: (blob: Blob) => Promise<void> | void;
}) {
  const imgRef = useRef<HTMLImageElement>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const [box, setBox] = useState<Box | null>(null);
  const [busy, setBusy] = useState(false);
  const [zoom, setZoom] = useState(1);

  useEffect(() => {
    if (!open) return;
    setBox(null);
    setBusy(false);
    setZoom(1);
    start.current = null;
  }, [open, pageUrl]);

  function point(event: PointerEvent) {
    const img = imgRef.current;
    if (!img) return null;
    const rect = img.getBoundingClientRect();
    return {
      x: Math.min(rect.width, Math.max(0, event.clientX - rect.left)),
      y: Math.min(rect.height, Math.max(0, event.clientY - rect.top)),
    };
  }

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    const next = point(event);
    if (!next) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    start.current = next;
    setBox({ x: next.x, y: next.y, w: 0, h: 0 });
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    const origin = start.current;
    const next = point(event);
    if (!origin || !next) return;
    setBox({
      x: Math.min(origin.x, next.x),
      y: Math.min(origin.y, next.y),
      w: Math.abs(next.x - origin.x),
      h: Math.abs(next.y - origin.y),
    });
  }

  function onPointerUp() {
    start.current = null;
  }

  const ready = !!box && box.w >= 16 && box.h >= 16;

  async function save() {
    const img = imgRef.current;
    if (!img || !box || !ready) return;
    setBusy(true);
    try {
      const res = await fetch(pageUrl);
      if (!res.ok) throw new Error("这一页的图片读不出来");
      const blob = await cropRectFromBlob(await res.blob(), box, { w: img.clientWidth, h: img.clientHeight });
      await onConfirm(blob);
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "没能保存这块截图");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!busy) onOpenChange(next); }}>
      <DialogContent className="max-h-[92vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>在本页框选图表</DialogTitle>
          <DialogDescription>按住拖动，框住整张 Figure。图太小可以先放大，再松开后点「保存这个范围」。</DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-2">
          <Button type="button" size="sm" variant="outline" disabled={zoom <= 1} onClick={() => { setZoom((value) => Math.max(1, Math.round((value - 0.5) * 10) / 10)); setBox(null); }}>缩小</Button>
          <span className="w-12 text-center text-xs tabular-nums text-muted-foreground">{Math.round(zoom * 100)}%</span>
          <Button type="button" size="sm" variant="outline" disabled={zoom >= 3} onClick={() => { setZoom((value) => Math.min(3, Math.round((value + 0.5) * 10) / 10)); setBox(null); }}>放大</Button>
        </div>
        <div className="max-h-[70vh] overflow-auto rounded border border-border bg-muted/30">
        <div
          className="relative inline-block cursor-crosshair touch-none select-none"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
        >
          {pageUrl ? (
            <img ref={imgRef} src={pageUrl} alt="试卷这一页" draggable={false} className="block max-w-none rounded bg-white" style={{ width: `${Math.round(zoom * 640)}px` }} />
          ) : null}
          {box && box.w > 0 && box.h > 0 ? (
            <div
              className="pointer-events-none absolute border-2 border-primary bg-primary/20"
              style={{ left: box.x, top: box.y, width: box.w, height: box.h }}
            />
          ) : null}
        </div>
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>取消</Button>
          <Button type="button" disabled={!ready || busy} onClick={() => void save()}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            保存这个范围
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
