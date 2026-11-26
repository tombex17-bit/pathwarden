import Decimal from 'break_infinity.js';

const SUFFIXES = ['', 'K', 'M', 'B', 'T'];

/** Whole numbers below 1,000; then K, M, B, T; then scientific such as 1.23e45. */
export function formatNumber(value: Decimal, round: 'down' | 'up' = 'down'): string {
  const cut = round === 'up' ? Math.ceil : Math.floor;
  // The small nudge keeps rounding errors from changing the last digit.
  const nudge = round === 'up' ? -1e-6 : 1e-6;
  if (value.lt(1000)) {
    const whole = cut(value.toNumber() + nudge);
    return whole < 1000 ? String(Math.max(0, whole)) : '1.00K';
  }
  const exponent = Math.floor(value.log10() + 1e-12);
  const group = Math.floor(exponent / 3);
  const shown = group < SUFFIXES.length ? group * 3 : exponent;
  let digits = cut(value.div(Decimal.pow10(shown)).toNumber() * 100 + nudge) / 100;
  if (group < SUFFIXES.length) {
    if (digits < 1000) return `${digits.toFixed(2)}${SUFFIXES[group]!}`;
    if (group + 1 < SUFFIXES.length) return `${(digits / 1000).toFixed(2)}${SUFFIXES[group + 1]!}`;
    return `${(digits / 1000).toFixed(2)}e${shown + 3}`;
  }
  let shownExponent = shown;
  if (digits >= 10) {
    digits /= 10;
    shownExponent++;
  }
  return `${digits.toFixed(2)}e${shownExponent}`;
}

/** For example "45 s", "2 min 5 s" or "3 h 10 min". */
export function formatDuration(seconds: number): string {
  const s = Math.floor(seconds);
  if (s < 60) return `${s} s`;
  const min = Math.floor(s / 60);
  if (min < 60) return `${min} min ${s % 60} s`;
  return `${Math.floor(min / 60)} h ${min % 60} min`;
}
