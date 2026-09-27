import { extname } from 'node:path'
import type { Range, Session } from './session.ts'

export function format(session: Session) {
  const printed = new Set<string>()

  return session.annotations
    .map((a) => {
      const heading = `## ${a.file}${a.range ? `:${lines(a.range)}` : ''}`
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

function lines({ start, end }: Range) {
  return start.line === end.line ? `${start.line + 1}` : `${start.line + 1}-${end.line + 1}`
}
