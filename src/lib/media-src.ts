/** Rewrite a Supabase public image URL so the browser loads it from this site. */
export function mediaSrc(url: string | null | undefined) {
  const raw = (url ?? "").trim();
  if (!raw || raw.startsWith("blob:") || raw.startsWith("data:") || raw.startsWith("/api/media")) return raw;
  if (!/\/storage\/v1\/object\/public\/question-images\//i.test(raw)) return raw;
  return `/api/media?u=${encodeURIComponent(raw)}`;
}

export function mediaSrcRetry(url: string | null | undefined, attempt: number) {
  const src = mediaSrc(url);
  if (!src || attempt <= 0) return src;
  return `${src}${src.includes("?") ? "&" : "?"}r=${attempt}`;
}
