import { createFileRoute } from "@tanstack/react-router";

function questionImagePath(raw: string) {
  try {
    const url = new URL(raw);
    const marker = "/storage/v1/object/public/question-images/";
    const at = url.pathname.indexOf(marker);
    if (at < 0) return null;
    const configured = (process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? "").replace(/\/$/, "");
    const allowedHost = configured ? new URL(configured).host : "";
    if (allowedHost && url.host !== allowedHost) return null;
    if (!allowedHost && !url.host.endsWith(".supabase.co")) return null;
    const path = decodeURIComponent(url.pathname.slice(at + marker.length)).replace(/^\/+/, "");
    if (!path || path.includes("..")) return null;
    return path;
  } catch {
    return null;
  }
}

function imageType(path: string, blobType: string) {
  if (blobType.startsWith("image/")) return blobType;
  const lower = path.toLowerCase();
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".gif")) return "image/gif";
  return "image/png";
}

export const Route = createFileRoute("/api/media")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const raw = new URL(request.url).searchParams.get("u") ?? "";
        const path = questionImagePath(raw);
        if (!path) return new Response("bad image", { status: 400 });
        const anon = process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? "";
        let last = "download failed";
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            const res = await fetch(raw, {
              headers: anon ? { apikey: anon } : {},
              signal: AbortSignal.timeout(15000),
            });
            if (res.ok) {
              const bytes = await res.arrayBuffer();
              return new Response(bytes, {
                headers: {
                  "Content-Type": imageType(path, res.headers.get("content-type") || ""),
                  "Cache-Control": "public, max-age=86400",
                },
              });
            }
            last = (await res.text()).slice(0, 180) || `status ${res.status}`;
          } catch (error) {
            last = error instanceof Error ? error.message : last;
          }
          if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)));
        }
        return new Response(last, { status: 502 });
      },
    },
  },
});
