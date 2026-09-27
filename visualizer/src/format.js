const nf = new Intl.NumberFormat('en-US')

export const int = (n) => nf.format(Math.round(n))

/** 1,284 B · 12.9 KB · 4.2 MB (binary units, as the allocator thinks). */
export function bytes(n, digits = 1) {
  if (!Number.isFinite(n)) return '∞'
  const a = Math.abs(n)
  if (a < 1024) return `${nf.format(n)} B`
  if (a < 1024 ** 2) return `${(n / 1024).toFixed(digits)} KB`
  if (a < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(digits)} MB`
  return `${(n / 1024 ** 3).toFixed(digits)} GB`
}

export const pct = (x, digits = 1) => `${(x * 100).toFixed(digits)}%`

/** Heap offset as hex, e.g. 0x1a40. */
export const hex = (n) => '0x' + Math.round(n).toString(16)

/** Short size-class label for a segregated-list bucket range. */
export function sizeRange([lo, hi]) {
  const f = (v) => (v >= 1024 ? `${v / 1024}K` : `${v}`)
  if (hi === Infinity) return `> ${f(lo - 16)}`
  if (lo === hi) return f(lo)
  return lo > 1024 ? `${f(lo - 16)}–${f(hi)}` : `${lo}–${f(hi)}`
}

export function compact(n) {
  const a = Math.abs(n)
  if (a < 1e3) return nf.format(n)
  if (a < 1e6) return `${+(n / 1e3).toFixed(1)}K`
  return `${+(n / 1e6).toFixed(1)}M`
}
