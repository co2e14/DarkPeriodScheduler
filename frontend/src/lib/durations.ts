import type { DurationRange, Stage } from '../types';

export type DurationKey = keyof DurationRange;
export const DURATION_KEYS: DurationKey[] = ['min_days', 'typical_days', 'max_days'];
export const DURATION_LABELS: Record<DurationKey, string> = {
  min_days: 'Min days',
  typical_days: 'Typical days',
  max_days: 'Max days',
};

/** Set one bound and keep min <= typical <= max (the backend rejects anything else). */
export function setBound<T extends DurationRange>(r: T, key: DurationKey, value: number): T {
  const next = { ...r, [key]: value };
  if (key === 'min_days') {
    next.max_days = Math.max(next.max_days, value);
    next.typical_days = Math.min(Math.max(next.typical_days, value), next.max_days);
  } else if (key === 'max_days') {
    next.min_days = Math.min(next.min_days, value);
    next.typical_days = Math.max(Math.min(next.typical_days, value), next.min_days);
  } else {
    next.typical_days = Math.min(Math.max(value, next.min_days), next.max_days);
  }
  return next;
}

export const stageRange = (s: Stage): DurationRange => ({
  min_days: s.min_days,
  typical_days: s.typical_days,
  max_days: s.max_days,
});

export const sameRange = (a: DurationRange, b: DurationRange) =>
  a.min_days === b.min_days && a.typical_days === b.typical_days && a.max_days === b.max_days;

export const describeRange = (r: DurationRange) =>
  r.min_days === r.max_days ? `${r.typical_days} d` : `${r.min_days}–${r.typical_days}–${r.max_days} d`;

export const toInt = (v: string | number, fallback = 0) => {
  const n = typeof v === 'number' ? v : parseInt(v, 10);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : fallback;
};
