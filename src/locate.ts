export type LineRange = { start: number; end: number }

export type Located = { count: number; range?: LineRange }

// One-based inclusive whole lines, excluding a final line touched only at column zero.
export function locate(text: string, quote: string): Located {
  const first = text.indexOf(quote)
  let count = 0

  for (let at = first; quote && at !== -1; at = text.indexOf(quote, at + 1)) count++

  if (count !== 1) return { count }
  const start = text.slice(0, first).split('\n').length
  const end = text.slice(0, first + quote.length).split('\n').length - (quote.endsWith('\n') ? 1 : 0)

  return { count, range: { start, end } }
}
