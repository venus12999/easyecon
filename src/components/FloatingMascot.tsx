import { useEffect, useRef, useState } from "react";
import mascotUrl from "@/assets/mascot.png";

const SIZE = 80;
const STORAGE_KEY = "mascot-pos-v1";

export function FloatingMascot() {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const dragRef = useRef<{ dx: number; dy: number; moved: boolean } | null>(null);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const p = JSON.parse(saved);
        if (typeof p.x === "number" && typeof p.y === "number") {
          setPos(clamp(p.x, p.y));
          return;
        }
      }
    } catch {}
    setPos({ x: window.innerWidth - SIZE - 12, y: 12 });
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
    try { (e.target as HTMLImageElement).releasePointerCapture(e.pointerId); } catch {}
    if (dragRef.current.moved && pos) {
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(pos)); } catch {}
    }
    dragRef.current = null;
  }

  if (!pos) return null;

  return (
    <img
      src={mascotUrl}
      alt=""
      aria-hidden="true"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDragStart={(e) => e.preventDefault()}
      className="fixed z-50 h-20 w-20 select-none drop-shadow-lg touch-none cursor-grab active:cursor-grabbing"
      style={{ left: pos.x, top: pos.y, imageRendering: "pixelated" }}
    />
  );
}