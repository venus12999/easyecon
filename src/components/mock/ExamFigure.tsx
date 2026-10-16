import { useEffect, useState } from "react";

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
    img.src = url;
  });
}

export function isThinFigure(width: number, height: number) {
  if (height < 90) return true;
  return width / Math.max(1, height) > 7 && height < 200;
}

/** Show the saved crop, and fall back to the full page when that crop is only a strip. */
export function ExamFigure({
  src,
  pageUrl,
  alt,
}: {
  src: string;
  pageUrl?: string | null;
  alt: string;
}) {
  const [pages, setPages] = useState<string[] | null>(null);
  const [shown, setShown] = useState(src);

  useEffect(() => {
    setShown(src);
    setPages(null);
  }, [src, pageUrl]);

  async function recover(width: number, height: number) {
    if (!isThinFigure(width, height)) return;
    if (pageUrl) {
      setShown(pageUrl);
      return;
    }
    const found = (await Promise.all(pageCandidates(src).map(loadSize))).filter((row): row is NonNullable<typeof row> => !!row && row.height >= 400);
    if (found.length === 0) return;
    setPages(found.map((row) => row.url));
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
      </div>
    );
  }

  return (
    <a href={shown} target="_blank" rel="noreferrer" className="block">
      <img
        src={shown}
        alt={alt}
        className="max-h-[70vh] max-w-full h-auto rounded border border-slate-300 bg-white"
        onLoad={(e) => {
          const img = e.currentTarget;
          if (img.src.split("?")[0] !== src.split("?")[0]) return;
          void recover(img.naturalWidth, img.naturalHeight);
        }}
      />
    </a>
  );
}
