// Local-first date utilities for Unfade.
// All date-partitioned data uses LOCAL calendar dates (not UTC).
// This matches the developer's clock — the natural mental model for a local tool.

/** Today's local date as YYYY-MM-DD. */
export function localToday(): string {
  return localDateStr(new Date());
}

/** Format a Date object as YYYY-MM-DD using LOCAL timezone. */
export function localDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Parse a YYYY-MM-DD string into a local-midnight Date. */
export function parseLocalDate(s: string): Date {
  const [y, mo, d] = s.split("-").map(Number);
  return new Date(y, mo - 1, d);
}

/** Validate YYYY-MM-DD format. */
export function isValidDateStr(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}
