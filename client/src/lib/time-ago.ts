/** Format an ISO timestamp as a short relative-time string ("just now", "5m ago", "3h ago", "2d ago"). */
export function formatTimeAgo(dateString: string): string {
  const diffMs = Date.now() - new Date(dateString).getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH}h ago`;
  const diffD = Math.floor(diffH / 24);
  return `${diffD}d ago`;
}
