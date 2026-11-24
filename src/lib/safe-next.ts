export function safeInternalDestination(requestedPath: string | null, origin: string): string {
  if (!requestedPath || !requestedPath.startsWith("/") || requestedPath.startsWith("//")) return "/";
  try {
    const base = new URL(origin);
    const destination = new URL(requestedPath, base);
    if (destination.origin !== base.origin) return "/";
    return `${destination.pathname}${destination.search}${destination.hash}`;
  } catch {
    return "/";
  }
}
