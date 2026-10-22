import { useEffect, useRef, useState } from "react";
import { mediaSrc, mediaSrcRetry } from "@/lib/media-src";

function pageCandidates(src: string) {
  const clean = src.split("?")[0];
  if (!/\/(mcq|frq)-\d+\.png$/i.test(clean)) return [];
  return Array.from({ length: 8 }, (_, i) => clean.replace(/\/[^/]+$/, `/page-${i + 1}.png`));
}

function loadSize(url: string) {
  return new Promise<{ url: string; width: number; height: number } | null>((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ url, width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => resolve(null);
    img.src = mediaSrc(url);
  });
}

export function isThinFigure(width: number, height: number) {
  if (height < 90) return true;
  return width / Math.max(1, height) > 7 && height < 200;
}

function isCleanAsset(src: string) {
  return src.split("?")[0].startsWith("/papers/");
}

/** Show the saved crop through this site, and fall back to the full page when the crop fails or is only a strip. */
export function ExamFigure({
  src,
  pageUrl,
  alt,
}: {
  src: string;
  pageUrl?: string | null;
  alt: string;
}) {
  const crop = mediaSrc(src);
  const page = pageUrl ? mediaSrc(pageUrl) : "";
  const [pages, setPages] = useState<string[] | null>(null);
  const [usePage, setUsePage] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [broken, setBroken] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const retrying = useRef(false);

  useEffect(() => {
    setPages(null);
    setUsePage(false);
    setAttempt(0);
    setBroken(false);
    setLoaded(false);
    retrying.current = false;
  }, [src, pageUrl]);

  const shown = usePage && page ? page : crop;
  const busted = mediaSrcRetry(shown, attempt);

  async function recover(width: number, height: number) {
    if (isCleanAsset(src) || !isThinFigure(width, height) || usePage) return;
    if (page) {
      setUsePage(true);
      setAttempt(0);
      setLoaded(false);
      return;
    }
    const found = (await Promise.all(pageCandidates(src).map(loadSize))).filter((row): row is NonNullable<typeof row> => !!row && row.height >= 400);
    if (found.length === 0) return;
    setPages(found.map((row) => mediaSrc(row.url)));
  }

  function fail() {
    if (retrying.current) return;
    if (attempt < 4) {
      retrying.current = true;
      window.setTimeout(() => {
        retrying.current = false;
        setAttempt((n) => n + 1);
      }, 400 * (attempt + 1));
      return;
    }
    if (!usePage && page && page !== crop) {
      setUsePage(true);
      setAttempt(0);
      setLoaded(false);
      return;
    }
    setBroken(true);
  }

  function retry() {
    retrying.current = false;
    setBroken(false);
    setLoaded(false);
    setUsePage(false);
    setPages(null);
    setAttempt((n) => n + 1);
  }

  if (pages && pages.length > 0) {
    return (
      <div className="space-y-3">
        <p className="text-xs text-amber-800">这题的截图不完整，下面是原卷整页，请对照 Figure 作答。</p>
        {pages.map((url) => (
          <a key={url} href={url} target="_blank" rel="noreferrer" className="block">
            <img src={url} alt={alt} className="max-h-[70vh] max-w-full h-auto rounded border border-slate-300 bg-white" />
          </a>
        ))}
        <button type="button" className="text-xs text-primary" onClick={retry}>重新加载图表</button>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {broken ? (
        <div className="flex min-h-28 flex-col items-start justify-center gap-2 rounded border border-dashed border-slate-300 bg-white px-3 py-4 text-xs text-slate-600">
          <span>图表没有加载出来。</span>
          <button type="button" className="rounded border border-slate-300 bg-white px-2 py-1 text-primary" onClick={retry}>重新加载图表</button>
        </div>
      ) : (
        <a href={busted} target="_blank" rel="noreferrer" className="block">
          {!loaded ? <p className="mb-2 text-xs text-slate-500">正在加载图表…</p> : null}
          <img
            key={busted}
            src={busted}
            alt={alt}
            className="max-h-[70vh] max-w-full h-auto rounded border border-slate-300 bg-white"
            onLoad={(e) => {
              setLoaded(true);
              const img = e.currentTarget;
              if (usePage) return;
              void recover(img.naturalWidth, img.naturalHeight);
            }}
            onError={fail}
          />
        </a>
      )}
      {loaded && page ? (
        <div className="flex flex-wrap gap-3 text-xs">
          <button type="button" className="text-primary" onClick={() => { setUsePage(true); setBroken(false); setLoaded(false); setAttempt(0); }}>
            {usePage ? "正在显示原页" : "查看原页"}
          </button>
          <a href={page} target="_blank" rel="noreferrer" className="text-primary">打开原页</a>
        </div>
      ) : null}
    </div>
  );
}
