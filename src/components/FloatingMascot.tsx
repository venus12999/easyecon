import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  COMPANIONS,
  COMPANION_KEY,
  getCompanion,
  pickContextualLine,
  type CompanionId,
} from "@/lib/mascot-lines";

const SIZE = 80;
const STORAGE_KEY = "mascot-pos-v1";
const TIP_HIDDEN_KEY = "mascot-tip-hidden-date-v1";

function localDateKey() {
  const now = new Date();
  return `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
}

export function FloatingMascot() {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const [tip, setTip] = useState<string | null>(null);
  const [companionId, setCompanionId] = useState<CompanionId>("sarah");
  const [isDragging, setIsDragging] = useState(false);
  const [action, setAction] = useState(0);
  const dragRef = useRef<{ dx: number; dy: number; moved: boolean } | null>(null);

  useEffect(() => {
    const saved = localStorage.getItem(COMPANION_KEY);
    setCompanionId(getCompanion(saved).id);
    try {
      const savedPos = localStorage.getItem(STORAGE_KEY);
      if (savedPos) {
        const p = JSON.parse(savedPos);
        if (typeof p.x === "number" && typeof p.y === "number") {
          setPos(clamp(p.x, p.y));
          return;
        }
      }
    } catch {}
    setPos({ x: window.innerWidth - SIZE - 12, y: 12 });
  }, []);

  useEffect(() => {
    const today = localDateKey();
    setTip(localStorage.getItem(TIP_HIDDEN_KEY) === today ? null : pickContextualLine());
  }, []);

  // Listen for companion switches from Profile page and show intro bubble.
  useEffect(() => {
    function onCompanionChange(event: Event) {
      const detail = (event as CustomEvent<{ id: CompanionId }>).detail;
      if (!detail?.id) return;
      const next = getCompanion(detail.id);
      setCompanionId(next.id);
      setTip(next.intro);
      try { localStorage.removeItem(TIP_HIDDEN_KEY); } catch {}
    }
    window.addEventListener("companion:change", onCompanionChange as EventListener);
    return () => window.removeEventListener("companion:change", onCompanionChange as EventListener);
  }, []);

  function clamp(x: number, y: number) {
    const maxX = window.innerWidth - SIZE;
    const maxY = window.innerHeight - SIZE;
    return {
      x: Math.max(0, Math.min(maxX, x)),
      y: Math.max(0, Math.min(maxY, y)),
    };
  }

  function onPointerDown(e: React.PointerEvent<HTMLImageElement>) {
    if (!pos) return;
    (e.target as HTMLImageElement).setPointerCapture(e.pointerId);
    setIsDragging(true);
    dragRef.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y, moved: false };
  }

  function onPointerMove(e: React.PointerEvent<HTMLImageElement>) {
    if (!dragRef.current) return;
    dragRef.current.moved = true;
    const next = clamp(e.clientX - dragRef.current.dx, e.clientY - dragRef.current.dy);
    setPos(next);
  }

  function onPointerUp(e: React.PointerEvent<HTMLImageElement>) {
    if (!dragRef.current) return;
    const moved = dragRef.current.moved;
    try { (e.target as HTMLImageElement).releasePointerCapture(e.pointerId); } catch {}
    if (moved && pos) {
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(pos)); } catch {}
    }
    dragRef.current = null;
    setIsDragging(false);
    if (!moved) setAction((current) => current + 1);
  }

  function onDoubleClick() {
    const idx = COMPANIONS.findIndex((c) => c.id === companionId);
    const next = COMPANIONS[(idx + 1) % COMPANIONS.length];
    setCompanionId(next.id);
    try { localStorage.setItem(COMPANION_KEY, next.id); } catch {}
    setTip(next.intro);
    try { localStorage.removeItem(TIP_HIDDEN_KEY); } catch {}
  }

  function hideTip() {
    setTip(null);
    try { localStorage.setItem(TIP_HIDDEN_KEY, localDateKey()); } catch {}
  }

  if (!pos) return null;

  const bubbleLeft = pos.x >= 260 ? pos.x - 228 : pos.x + SIZE - 8;
  const bubbleTop = Math.max(8, pos.y + 4);
  const companion = getCompanion(companionId);

  return (
    <>
      {tip && (
        <aside
          aria-label={`${companion.name} 的话`}
          className="fixed z-50 w-56 rounded-2xl border bg-popover p-3 pr-9 text-sm text-popover-foreground shadow-lg"
          style={{ left: bubbleLeft, top: bubbleTop }}
        >
          <p className="mb-1 text-xs font-semibold text-primary">{companion.name} 学姐/学长</p>
          <p className="leading-relaxed">{tip}</p>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="关闭"
            onClick={hideTip}
            className="absolute right-1 top-1 h-7 w-7 rounded-full"
          >
            <X />
          </Button>
        </aside>
      )}
      <img
        src={companion.image}
        alt={companion.name}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={onDoubleClick}
        onAnimationEnd={() => setAction(0)}
        onDragStart={(e) => e.preventDefault()}
        className={`fixed z-50 h-20 w-20 select-none drop-shadow-lg touch-none cursor-grab active:cursor-grabbing ${
          isDragging ? "animate-mascot-drag" : action > 0 ? "animate-mascot-wave" : "animate-mascot-float"
        }`}
        style={{ left: pos.x, top: pos.y, imageRendering: "pixelated" }}
      />
    </>
  );
}