// Date helpers on ISO 'YYYY-MM-DD' strings. Everything runs in UTC so day
// arithmetic never drifts across DST changes or browser timezones.
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import type { Closure, ISODate } from '../types';

dayjs.extend(utc);

const ISO = 'YYYY-MM-DD';
export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export const d = (s: ISODate) => dayjs.utc(s);
export const addDays = (s: ISODate, n: number): ISODate => d(s).add(n, 'day').format(ISO);
export const daysBetween = (a: ISODate, b: ISODate) => d(b).diff(d(a), 'day');
export const weekdayIndex = (s: ISODate) => (d(s).day() + 6) % 7; // 0 = Mon
export const todayISO = (): ISODate => dayjs().format(ISO);
export const minDate = (xs: ISODate[]) => xs.reduce((a, b) => (b < a ? b : a));
export const maxDate = (xs: ISODate[]) => xs.reduce((a, b) => (b > a ? b : a));

export const fmt = (s: ISODate) => d(s).format('ddd D MMM YYYY');
export const fmtShort = (s: ISODate) => d(s).format('D MMM');
/** Last day of a half-open [start, end) range. */
export const lastDay = (end: ISODate) => addDays(end, -1);
export const fmtRange = (start: ISODate, endExclusive: ISODate) =>
  daysBetween(start, endExclusive) <= 1
    ? fmt(start)
    : `${fmtShort(start)} → ${fmt(lastDay(endExclusive))}`;

export function closureDays(closures: Closure[]): Set<ISODate> {
  const out = new Set<ISODate>();
  for (const c of closures) {
    for (let x = c.start; x <= c.end; x = addDays(x, 1)) out.add(x);
  }
  return out;
}

export const uid = (prefix: string) => `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
