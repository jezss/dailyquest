export function uid(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return 'id-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export function toISODate(ms: number): string {
  const d = new Date(ms);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

export function parseISODate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

export function addDays(iso: string, n: number): string {
  const d = parseISODate(iso);
  d.setDate(d.getDate() + n);
  return toISODate(d.getTime());
}

/** The `count` dates ending at `end` (inclusive), oldest first. */
export function lastDates(end: string, count: number): string[] {
  return Array.from({ length: count }, (_, i) => addDays(end, i - (count - 1)));
}

export function startOfDayMs(iso: string): number {
  return parseISODate(iso).getTime();
}

export function formatDate(iso: string): string {
  return parseISODate(iso).toLocaleDateString(undefined, {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

export function formatShortDate(iso: string): string {
  return parseISODate(iso).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

export function weekdayLetter(iso: string): string {
  return parseISODate(iso).toLocaleDateString(undefined, { weekday: 'short' });
}
