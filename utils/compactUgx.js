'use strict';

// Compact money for cards and titles: up to 2 decimals, trailing zeros
// trimmed, never more than 1% off the real amount.
//   2,300,000 → "2.3M"   1,250,000 → "1.25M"   850,000 → "850k"
//   1,500,000,000 → "1.5B"   1,000,000,000 → "1B"
// (It used to be Math.round(v / 1e6) + "M", so 2,300,000 showed as "2M".)
// assets/makaug-app.js has the same function (formatCompact); a test checks both.

const UNITS = [
  { size: 1e12, suffix: 'T' },
  { size: 1e9, suffix: 'B' },
  { size: 1e6, suffix: 'M' },
  { size: 1e3, suffix: 'k' }
];

function compactUgx(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return '';
  const sign = amount < 0 ? '-' : '';
  const abs = Math.abs(amount);
  for (let index = 0; index < UNITS.length; index += 1) {
    const unit = UNITS[index];
    if (abs < unit.size) continue;
    const scaled = abs / unit.size;
    let text = '';
    for (let decimals = 0; decimals <= 2; decimals += 1) {
      const rounded = Number(scaled.toFixed(decimals));
      text = String(rounded);
      if (Math.abs(rounded - scaled) / scaled <= 0.01) break;
    }
    // 999,999 rounds to "1000k": show it in the next unit up instead.
    if (Number(text) >= 1000 && index > 0) {
      const bigger = UNITS[index - 1];
      return `${sign}${String(Number((abs / bigger.size).toFixed(2)))}${bigger.suffix}`;
    }
    return `${sign}${text}${unit.suffix}`;
  }
  return `${sign}${Math.round(abs).toLocaleString('en-US')}`;
}

module.exports = { compactUgx };
