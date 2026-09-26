import { extname } from 'node:path'
import type { Session } from './session.ts'

// Every annotation in the order it was written. A thread's snippet is printed only the first time.
export function format(session: Session) {
  const printed = new Set<string>()
  return session.annotations
    .map((a) => {
      const [start, end] = [a.range.start.line + 1, a.range.end.line + 1]
      const lines = start === end ? `${start}` : `${start}-${end}`
      const heading = `## ${a.file}:${lines}`
      const snippet = printed.has(a.threadId) ? '' : fenced(a.snippet, extname(a.file).slice(1))
      printed.add(a.threadId)
      return [heading, snippet, a.body].filter(Boolean).join('\n\n')
    })
    .join('\n\n')
}

function fenced(code: string, language: string) {
  code = code.replace(/^\s*\n/, '').trimEnd()
  if (!code) return ''
  let fence = '```'
  while (code.includes(fence)) fence += '`'
  return `${fence}${language}\n${code}\n${fence}`
}
