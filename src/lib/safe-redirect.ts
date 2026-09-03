/** Only allow in-app paths so login cannot bounce to an external URL. */
export function safeRedirectPath(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const path = raw.trim();
  if (!path.startsWith("/")) return undefined;
  if (path.startsWith("//") || path.startsWith("/\\")) return undefined;
  if (path.includes("://")) return undefined;
  if (path === "/auth" || path.startsWith("/auth?")) return undefined;
  return path;
}
