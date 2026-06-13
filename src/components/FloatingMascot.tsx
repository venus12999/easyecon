import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import mascot1Url from "@/assets/mascot.png";
import mascot2Url from "@/assets/mascot2.png";
import { Button } from "@/components/ui/button";

const MASCOTS = [mascot1Url, mascot2Url];
const MASCOT_KEY = "mascot-variant-v1";

const SIZE = 80;
const STORAGE_KEY = "mascot-pos-v1";
const TIP_HIDDEN_KEY = "mascot-tip-hidden-date-v1";
const TIPS = [
  "读图题先看坐标轴和曲线方向，再判断价格与数量的变化。",
  "看到 ceteris paribus，要记得其他条件保持不变。",
  "需求量变化是沿曲线移动，需求变化才会让整条曲线移动。",
  "先圈出题目问的是 marginal 还是 total，别被相似术语带偏。",
  "价格上限只有低于均衡价格时才会真正产生约束。",
  "做弹性题时，先判断百分比变化，再比较需求量与价格的反应幅度。",
  "遇到税收题，先找买卖双方的新价格，税负不一定各承担一半。",
  "短期做错题不可怕，把错误原因说清楚才是真正掌握。",
];

function localDateKey() {
  const now = new Date();
  return `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
}

function tipForToday() {
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 0);
  const day = Math.floor((now.getTime() - start.getTime()) / 86_400_000);
  return TIPS[day % TIPS.length];
}

export function FloatingMascot() {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const [tip, setTip] = useState<string | null>(null);
  const [variant, setVariant] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [action, setAction] = useState(0);
  const dragRef = useRef<{ dx: number; dy: number; moved: boolean } | null>(null);

  useEffect(() => {
    const savedVariant = Number(localStorage.getItem(MASCOT_KEY) ?? 0);
    if (Number.isFinite(savedVariant) && savedVariant >= 0 && savedVariant < MASCOTS.length) {
      setVariant(savedVariant);
    }
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

  useEffect(() => {
    const today = localDateKey();
    setTip(localStorage.getItem(TIP_HIDDEN_KEY) === today ? null : tipForToday());
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
    const next = (variant + 1) % MASCOTS.length;
    setVariant(next);
    try { localStorage.setItem(MASCOT_KEY, String(next)); } catch {}
  }

  function hideTip() {
    setTip(null);
    try { localStorage.setItem(TIP_HIDDEN_KEY, localDateKey()); } catch {}
  }

  if (!pos) return null;

  const bubbleLeft = pos.x >= 260 ? pos.x - 228 : pos.x + SIZE - 8;
  const bubbleTop = Math.max(8, pos.y + 4);

  return (
    <>
      {tip && (
        <aside
          aria-label="今日小贴士"
          className="fixed z-50 w-56 rounded-2xl border bg-popover p-3 pr-9 text-sm text-popover-foreground shadow-lg"
          style={{ left: bubbleLeft, top: bubbleTop }}
        >
          <p className="mb-1 text-xs font-semibold text-primary">今日小贴士</p>
          <p className="leading-relaxed">{tip}</p>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="关闭今日小贴士"
            onClick={hideTip}
            className="absolute right-1 top-1 h-7 w-7 rounded-full"
          >
            <X />
          </Button>
        </aside>
      )}
      <img
        key={`${variant}-${action}`}
        src={MASCOTS[variant]}
        alt=""
        aria-hidden="true"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={onDoubleClick}
        onDragStart={(e) => e.preventDefault()}
        className={`fixed z-50 h-20 w-20 select-none drop-shadow-lg touch-none cursor-grab active:cursor-grabbing ${
          isDragging ? "animate-mascot-drag" : action > 0 ? "animate-mascot-wave" : "animate-mascot-float"
        }`}
        style={{ left: pos.x, top: pos.y, imageRendering: "pixelated" }}
      />
    </>
  );
}