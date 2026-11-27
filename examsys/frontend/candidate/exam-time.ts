export function formatOpensIn(startAt: string, now: number): string {
  const remainingMs = Date.parse(startAt) - now;
  if (!Number.isFinite(remainingMs) || remainingMs <= 0) return "Opening soon";

  const totalMinutes = Math.ceil(remainingMs / 60_000);
  if (totalMinutes < 60) return `Opens in ${totalMinutes} min`;
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `Opens in ${days}d ${hours}h`;
  return `Opens in ${hours}h ${minutes}m`;
}

export function formatDateTime(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Schedule not available";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}
